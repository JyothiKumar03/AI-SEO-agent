import type { CoreMessage } from "ai";
import { z } from "zod";
import { env, type TokenPricingConfig } from "../config/env";
import { SEO_AGENT_PROMPTS } from "../prompts/seoAgents";
import { call_ai_model } from "../services/ai/client";
import {
  build_blog_weaver_input,
  type BuildBlogWeaverInputOptions,
} from "../services/seo/blog-input";
import {
  analyze_context_with_textrazor,
  TextRazorError,
} from "../services/seo/textrazor";
import type {
  AiCallConfig,
  AiCallOverrides,
  AiCallResult,
  AiProvider,
  AiToolSet,
} from "../types/ai";
import {
  agent_facts_result_schema,
  type AgentFactsResult,
  type AgentIdentifier,
  type BlogWeaverInput,
  type PeopleAlsoAskQuestion,
  type ResearchFact,
  type SeoAgentContext,
  type SeoWorkflowOptions,
  type SeoWorkflowOutputs,
  type SeoWorkflowResult,
  type SeoWorkflowTiming,
  type TextRazorInsights,
} from "../types/seo";
import { JsonParseError, parse_json } from "../utils/json";
import { create_logger } from "../utils/logger";

const DEFAULT_PROVIDER: AiProvider = "openai";

const agent_defaults: Record<AgentIdentifier, AiCallOverrides> = {
  factsResearcher: { temperature: 0.15, max_tokens: 3000 },
  blogWeaver: {
    temperature: 0.5,
    max_tokens: 9000,
    // model: "gpt-5-2025-08-07",
    model: "gpt-5.1-2025-11-13",
    reasoning_effort: "medium",
  },
};

const prompt_keys = {
  factsResearcher: "factsResearcher",
  blogWeaver: "blogWeaver",
} as const;

const build_messages = (
  system_prompt: string,
  payload: unknown
): CoreMessage[] => [
  { role: "system", content: system_prompt },
  { role: "user", content: JSON.stringify(payload, null, 2) },
];

const create_gemini_tools = (): AiToolSet => ({
  google_grounding: {
    execute: () => "google_grounding",
    input_schema: z.object({
      query: z.string().describe("The research query to run"),
    }),
    description: "Performs a grounded Google search.",
  },
  url_context: {
    execute: () => "url_context",
    input_schema: z.object({
      url: z.string().url().describe("The URL to fetch for fact verification"),
    }),
    description: "Fetches content from a URL for verification.",
  },
});

interface ModelIdentifierInfo {
  identifier: string;
  modelId?: string;
}

const collect_model_id = (
  agent: AgentIdentifier,
  provider: AiProvider,
  raw_response: unknown,
  models: Record<string, string>
): ModelIdentifierInfo => {
  const response_record =
    raw_response && typeof raw_response === "object"
      ? (raw_response as Record<string, unknown>)
      : undefined;
  const model_id =
    (response_record?.response as Record<string, unknown> | undefined)
      ?.modelId ??
    (response_record?.providerMetadata as Record<string, unknown> | undefined)
      ?.modelId;

  const value = model_id ? `${provider}:${model_id}` : provider;
  models[agent] = value;

  const info: ModelIdentifierInfo = { identifier: value };
  if (typeof model_id === "string" && model_id.length > 0) {
    info.modelId = model_id;
  }

  return info;
};

const normalize_context_rows = (context: SeoAgentContext): SeoAgentContext => {
  const rows = [...context.rows].sort((a, b) => a.order - b.order);
  return { ...context, rows };
};

interface TokenUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  reasoningTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
}

interface UsageBreakdownEntry extends TokenUsage {
  agent: AgentIdentifier;
  provider: AiProvider;
  model: string;
  modelId?: string | undefined;
  costUsd?: number | undefined;
}

interface UsageAccumulator {
  breakdown: UsageBreakdownEntry[];
  totalCostUsd: number;
}

const DEFAULT_TOKEN_PRICING: Record<string, TokenPricingConfig> = {
  "openai:gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "openai:gpt-4o": { input: 0.0005, output: 0.0015 },
  openai: { input: 0.00015, output: 0.0006 },
  "openai:gpt-5-2025-08-07": { input: 0.01, output: 0.03 },
  "anthropic:claude-3-5-haiku-latest": { input: 0.0008, output: 0.0008 },
  anthropic: { input: 0.0008, output: 0.0008 },
  "gemini:gemini-2.5-pro": { input: 0.00035, output: 0.00105 },
  gemini: { input: 0.00035, output: 0.00105 },
};

const pick_number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const normalize_usage = (usage: Record<string, unknown>): TokenUsage => {
  const candidates: Array<Record<string, unknown>> = [];

  if (usage && typeof usage === "object") {
    candidates.push(usage);
    const tokens = (usage as Record<string, unknown>).tokens;
    if (tokens && typeof tokens === "object") {
      candidates.push(tokens as Record<string, unknown>);
    }
  }

  const extract = (keys: string[]): number | undefined => {
    for (const candidate of candidates) {
      for (const key of keys) {
        const value = pick_number(candidate[key]);
        if (value !== undefined) {
          return value;
        }
      }
    }
    return undefined;
  };

  return {
    inputTokens: extract(["inputTokens", "promptTokens", "prompt_tokens"]),
    outputTokens: extract([
      "outputTokens",
      "completionTokens",
      "completion_tokens",
    ]),
    totalTokens: extract(["totalTokens", "total_tokens"]),
    reasoningTokens: extract(["reasoningTokens"]),
    cachedInputTokens: extract(["cachedInputTokens", "cached_input_tokens"]),
  };
};

const lookup_pricing = (
  sources: Array<Record<string, TokenPricingConfig>>,
  keys: string[]
): TokenPricingConfig | undefined => {
  for (const source of sources) {
    for (const key of keys) {
      const entry = source[key];
      if (entry) {
        return entry;
      }
    }
  }
  return undefined;
};

const resolve_token_pricing = (
  provider: AiProvider,
  model_id?: string
): TokenPricingConfig | undefined => {
  const provider_key = provider.toLowerCase();
  const model_key = model_id?.toLowerCase();

  const keys: string[] = [];
  if (model_key) {
    keys.push(`${provider_key}:${model_key}`, model_key);
  }
  keys.push(provider_key);

  const override = lookup_pricing([env.aiTokenPricing], keys);
  if (override) {
    return override;
  }

  return lookup_pricing([DEFAULT_TOKEN_PRICING], keys);
};

const calculate_usage_cost = (
  provider: AiProvider,
  model_id: string | undefined,
  usage: TokenUsage
): number | undefined => {
  const pricing = resolve_token_pricing(provider, model_id);
  if (!pricing) {
    return undefined;
  }

  const rate = (
    tokens: number | undefined,
    price_per_thousand: number | undefined,
    fallback?: number
  ): number => {
    if (!tokens || tokens <= 0) {
      return 0;
    }
    const rate_to_use = price_per_thousand ?? fallback ?? 0;
    if (rate_to_use <= 0) {
      return 0;
    }
    return (tokens / 1000) * rate_to_use;
  };

  const input_cost = rate(usage.inputTokens, pricing.input);
  const output_cost = rate(usage.outputTokens, pricing.output);
  const reasoning_cost = rate(
    usage.reasoningTokens,
    pricing.reasoning,
    pricing.output ?? pricing.input
  );
  const cached_cost = rate(
    usage.cachedInputTokens,
    pricing.cachedInput,
    pricing.input
  );

  const total = input_cost + output_cost + reasoning_cost + cached_cost;
  return total > 0 ? total : undefined;
};

interface RunAgentConfig<T> {
  agent: AgentIdentifier;
  provider: AiProvider;
  messages: CoreMessage[];
  parser?: (text: string, structured?: T) => T;
  overrides?: AiCallOverrides;
  logger_scope: ReturnType<typeof create_logger>;
  timings: SeoWorkflowTiming[];
  models: Record<string, string>;
  usage_summary: UsageAccumulator;
  output_schema?: z.ZodType<T>;
}

const run_agent_call = async <T>({
  agent,
  provider,
  messages,
  parser,
  overrides,
  logger_scope,
  timings,
  models,
  usage_summary,
  output_schema,
}: RunAgentConfig<T>): Promise<T> => {
  const merged_overrides = {
    ...agent_defaults[agent],
    ...(overrides ?? {}),
  };

  const { result, durationMs: duration_ms } = await logger_scope.measure(
    agent,
    async (): Promise<AiCallResult<T>> => {
      const call_config: AiCallConfig<T> = {
        provider,
        messages,
        ...(merged_overrides.model
          ? { model_name: merged_overrides.model }
          : {}),
        ...(typeof merged_overrides.temperature === "number"
          ? { temperature: merged_overrides.temperature }
          : {}),
        ...(typeof merged_overrides.max_tokens === "number"
          ? { max_tokens: merged_overrides.max_tokens }
          : {}),
        ...(provider === "gemini" && agent === "factsResearcher"
          ? { tools: create_gemini_tools() }
          : {}),
        ...(merged_overrides.reasoning_effort
          ? { reasoning_effort: merged_overrides.reasoning_effort }
          : {}),
        ...(output_schema ? { output_schema } : {}),
      };

      return call_ai_model<T>(call_config);
    }
  );

  timings.push({
    step: agent,
    durationMs: Number(duration_ms.toFixed(2)),
  });

  const model_info = collect_model_id(
    agent,
    provider,
    result.raw_response,
    models
  );
  const usage_data = normalize_usage(
    (result.usage ?? {}) as Record<string, unknown>
  );
  const cost_usd = calculate_usage_cost(
    provider,
    model_info.modelId,
    usage_data
  );

  const breakdown_entry: UsageBreakdownEntry = {
    agent,
    provider,
    model: model_info.identifier,
    modelId: model_info.modelId,
    ...usage_data,
  };

  if (typeof cost_usd === "number") {
    breakdown_entry.costUsd = cost_usd;
    usage_summary.totalCostUsd += cost_usd;
  }

  usage_summary.breakdown.push(breakdown_entry);

  const raw_text = result.text ?? "";
  logger_scope.debug(`${agent}::rawTextPreview`, {
    preview: raw_text.slice(0, 200),
    totalChars: raw_text.length,
  });

  const structured_output = output_schema ? result.parsed_output : undefined;

  try {
    const trimmed = raw_text.trim();
    if (parser) {
      return parser(trimmed, structured_output);
    }
    if (structured_output !== undefined) {
      return structured_output;
    }
    if (trimmed.length === 0) {
      logger_scope.warn(`${agent}::emptyResponse`, {
        message: "Agent returned empty response; injecting empty JSON object.",
      });
    }
    return trimmed as unknown as T;
  } catch (error) {
    if (error instanceof JsonParseError) {
      logger_scope.error(`${agent}::parsingFailed`, {
        message: error.message,
        details: error.original,
      });
    }
    throw error;
  }
};

const select_provider_for_agent = (
  agent: AgentIdentifier,
  base_provider: AiProvider
): AiProvider => {
  if (agent === "factsResearcher") {
    return "gemini";
  }
  if (agent === "blogWeaver") {
    return "openai";
  }
  return base_provider;
};

const prepare_overrides = (
  agent: AgentIdentifier,
  overrides?: SeoWorkflowOptions["overrides"]
): AiCallOverrides | undefined => overrides?.[agent];

const sanitize_fact = (candidate: unknown): ResearchFact => {
  if (!candidate || typeof candidate !== "object") {
    return {
      fact: "",
      publisher: "",
      title: "",
      url: "",
      published_date: "",
      updated_date: "",
      evidence_type: "",
      conflict: false,
    };
  }

  const entry = candidate as Record<string, unknown>;
  return {
    fact: typeof entry.fact === "string" ? entry.fact : "",
    publisher: typeof entry.publisher === "string" ? entry.publisher : "",
    title: typeof entry.title === "string" ? entry.title : "",
    url: typeof entry.url === "string" ? entry.url : "",
    published_date:
      typeof entry.published_date === "string" ? entry.published_date : "",
    updated_date:
      typeof entry.updated_date === "string" ? entry.updated_date : "",
    evidence_type:
      typeof entry.evidence_type === "string" ? entry.evidence_type : "",
    conflict: typeof entry.conflict === "boolean" ? entry.conflict : false,
  };
};

const sanitize_paa_question = (candidate: unknown): PeopleAlsoAskQuestion => {
  if (!candidate || typeof candidate !== "object") {
    return {
      question: "",
      serp_keyword: "",
      region: "",
    };
  }

  const entry = candidate as Record<string, unknown>;
  return {
    question: typeof entry.question === "string" ? entry.question : "",
    serp_keyword:
      typeof entry.serp_keyword === "string" ? entry.serp_keyword : "",
    region: typeof entry.region === "string" ? entry.region : "",
  };
};

const parse_facts_response = (
  text: string,
  structured_output?: Partial<AgentFactsResult>
): AgentFactsResult => {
  const parsed =
    structured_output ??
    parse_json<Partial<AgentFactsResult>>(text.length === 0 ? "{}" : text);

  const facts = Array.isArray(parsed.facts)
    ? parsed.facts
        .map(sanitize_fact)
        .filter((fact) => fact.fact.trim().length > 0)
    : [];
  const paa_questions = Array.isArray(parsed.paa_questions)
    ? parsed.paa_questions
        .map(sanitize_paa_question)
        .filter((item) => item.question.trim().length > 0)
    : [];
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter(
        (warning): warning is string =>
          typeof warning === "string" && warning.trim().length > 0
      )
    : [];
  return {
    facts,
    paa_questions,
    warnings,
  };
};

interface WorkflowRuntime {
  logger: ReturnType<typeof create_logger>;
  timings: SeoWorkflowTiming[];
  models: Record<string, string>;
  usage_summary: UsageAccumulator;
}

const create_workflow_runtime = (topic: string): WorkflowRuntime => ({
  logger: create_logger(`SEO_WORKFLOW:${topic}`),
  timings: [],
  models: {},
  usage_summary: {
    breakdown: [],
    totalCostUsd: 0,
  },
});

export const run_textrazor_stage = async (
  context: SeoAgentContext,
  runtime: WorkflowRuntime
): Promise<TextRazorInsights> => {
  const start = Date.now();
  const insights = await analyze_context_with_textrazor(context);
  const duration = Date.now() - start;
  runtime.timings.push({
    step: "textrazor",
    durationMs: Number(duration.toFixed(2)),
  });
  return insights;
};

export const run_facts_researcher_stage = async (
  context: SeoAgentContext,
  textrazor_insights: TextRazorInsights,
  base_provider: AiProvider,
  overrides: AiCallOverrides | undefined,
  runtime: WorkflowRuntime
): Promise<AgentFactsResult> => {
  try {
    return await run_agent_call<AgentFactsResult>({
      agent: "factsResearcher",
      provider: select_provider_for_agent("factsResearcher", base_provider),
      messages: build_messages(SEO_AGENT_PROMPTS[prompt_keys.factsResearcher], {
        context,
        textrazor: textrazor_insights,
      }),
      parser: (text, structured) => parse_facts_response(text, structured),
      ...(overrides ? { overrides } : {}),
      logger_scope: runtime.logger,
      timings: runtime.timings,
      models: runtime.models,
      usage_summary: runtime.usage_summary,
      output_schema: agent_facts_result_schema,
    });
  } catch (error) {
    runtime.logger.warn("facts_fetch_failed", {
      message:
        error instanceof Error ? error.message : "Unknown facts fetch error",
    });
    return { facts: [], paa_questions: [], warnings: [] };
  }
};

export const run_blog_weaver_stage = async (
  blog_input: BlogWeaverInput,
  base_provider: AiProvider,
  overrides: AiCallOverrides | undefined,
  runtime: WorkflowRuntime
): Promise<string> => {
  return run_agent_call<string>({
    agent: "blogWeaver",
    provider: select_provider_for_agent("blogWeaver", base_provider),
    messages: build_messages(
      SEO_AGENT_PROMPTS[prompt_keys.blogWeaver],
      blog_input
    ),
    parser: (text) => text.trim(),
    ...(overrides ? { overrides } : {}),
    logger_scope: runtime.logger,
    timings: runtime.timings,
    models: runtime.models,
    usage_summary: runtime.usage_summary,
  });
};

export const run_seo_workflow = async (
  options: SeoWorkflowOptions
): Promise<SeoWorkflowResult> => {
  const context = normalize_context_rows(options.context);
  const base_provider: AiProvider = options.provider ?? DEFAULT_PROVIDER;
  const runtime = create_workflow_runtime(context.blog_topic);

  let textrazor_insights: TextRazorInsights;

  try {
    textrazor_insights = await run_textrazor_stage(context, runtime);
  } catch (error) {
    if (error instanceof TextRazorError) {
      runtime.logger.error("textrazor_failed", { message: error.message });
    }
    throw error;
  }

  const overrides = options.overrides ?? {};
  const facts_overrides = prepare_overrides("factsResearcher", overrides);

  const facts = await run_facts_researcher_stage(
    context,
    textrazor_insights,
    base_provider,
    facts_overrides,
    runtime
  );

  const blog_input_options: BuildBlogWeaverInputOptions = {};
  if (
    typeof options.audienceOverride === "string" &&
    options.audienceOverride.trim().length > 0
  ) {
    blog_input_options.audience_override = options.audienceOverride.trim();
  }
  if (
    typeof options.brandVoiceOverride === "string" &&
    options.brandVoiceOverride.trim().length > 0
  ) {
    blog_input_options.brand_voice_override = options.brandVoiceOverride.trim();
  }
  if (
    typeof options.localeOverride === "string" &&
    options.localeOverride.trim().length > 0
  ) {
    blog_input_options.locale = options.localeOverride.trim();
  }
  if (typeof options.ymyl === "boolean") {
    blog_input_options.ymyl = options.ymyl;
  }
  if (options.publishMode === "draft" || options.publishMode === "publish") {
    blog_input_options.publish_mode = options.publishMode;
  }

  const blog_input: BlogWeaverInput = build_blog_weaver_input(
    context,
    textrazor_insights,
    facts,
    options.siteStructure,
    blog_input_options
  );

  const blog_overrides = prepare_overrides("blogWeaver", overrides);

  const draft = await run_blog_weaver_stage(
    blog_input,
    base_provider,
    blog_overrides,
    runtime
  );

  const formatted_breakdown = runtime.usage_summary.breakdown.map((entry) => ({
    ...entry,
    ...(typeof entry.costUsd === "number"
      ? { costUsd: Number(entry.costUsd.toFixed(6)) }
      : {}),
  }));

  runtime.logger.info("llm_cost_summary", {
    totalUsd: Number(runtime.usage_summary.totalCostUsd.toFixed(6)),
    breakdown: formatted_breakdown,
  });

  const outputs: SeoWorkflowOutputs = {
    textrazor: textrazor_insights,
    facts,
    blogInput: blog_input,
    draft,
  };

  return {
    context,
    ...(options.siteStructure ? { siteStructure: options.siteStructure } : {}),
    outputs,
    timings: runtime.timings,
    provider: base_provider,
    models: runtime.models,
  };
};
