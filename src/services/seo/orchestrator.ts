import type { CoreMessage } from "ai";
import { z } from "zod";
import { SEO_AGENT_PROMPTS } from "../../prompts/seoAgents";
import { parseJson, JsonParseError } from "../../utils/json";
import { createLogger } from "../../utils/logger";
import { env, type TokenPricingConfig } from "../../config/env";
import {
  generateAiText,
  type AiProvider,
  type GenerateAiTextOptions,
  type GenerateAiTextResult,
  type ToolSet,
} from "../aiClient";
import {
  buildBlogWeaverInput,
  type BuildBlogWeaverInputOptions,
} from "./blogInput";
import {
  analyzeContextWithTextRazor,
  TextRazorError,
} from "./textrazor";
import type {
  AgentFactsResult,
  AgentIdentifier,
  AiCallOverrides,
  BlogWeaverInput,
  PeopleAlsoAskQuestion,
  ResearchFact,
  SeoAgentContext,
  SeoWorkflowOptions,
  SeoWorkflowOutputs,
  SeoWorkflowResult,
  SeoWorkflowTiming,
  TextRazorInsights,
} from "./types";

const DEFAULT_PROVIDER: AiProvider = "openai";

const agentDefaults: Record<AgentIdentifier, AiCallOverrides> = {
  factsResearcher: { temperature: 0.15, maxTokens: 3000 },
  blogWeaver: {
    temperature: 0.5,
    maxTokens: 9000,
    // model: "gpt-5-2025-08-07",
    model:'gpt-5.1-2025-11-13',
    reasoningEffort: "medium",
  },
};

const promptKeys = {
  factsResearcher: "factsResearcher",
  blogWeaver: "blogWeaver",
} as const;

const buildMessages = (
  systemPrompt: string,
  payload: unknown
): CoreMessage[] => [
  { role: "system", content: systemPrompt },
  { role: "user", content: JSON.stringify(payload, null, 2) },
];

const createGeminiTools = (): ToolSet => ({
  google_grounding: {
    execute: () => "google_grounding",
    inputSchema: z.object({
      query: z.string().describe("The research query to run"),
    }),
    description: "Performs a grounded Google search.",
  },
  url_context: {
    execute: () => "url_context",
    inputSchema: z.object({
      url: z
        .string()
        .url()
        .describe("The URL to fetch for fact verification"),
    }),
    description: "Fetches content from a URL for verification.",
  },
});

interface ModelIdentifierInfo {
  identifier: string;
  modelId?: string;
}

const collectModelId = (
  agent: AgentIdentifier,
  provider: AiProvider,
  result: GenerateAiTextResult,
  models: Record<string, string>
): ModelIdentifierInfo => {
  const modelId =
    result.rawResponse?.response?.modelId ??
    result.rawResponse?.providerMetadata?.modelId;
  const value = modelId ? `${provider}:${modelId}` : provider;
  models[agent] = value;
  return { identifier: value, modelId: modelId ?? undefined };
};

const normalizeContextRows = (context: SeoAgentContext): SeoAgentContext => {
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
  "openai": { input: 0.00015, output: 0.0006 },
  "openai:gpt-5-2025-08-07": { input: 0.01, output: 0.03 },
  "anthropic:claude-3-5-haiku-latest": { input: 0.0008, output: 0.0008 },
  "anthropic": { input: 0.0008, output: 0.0008 },
  "gemini:gemini-2.5-pro": { input: 0.00035, output: 0.00105 },
  "gemini": { input: 0.00035, output: 0.00105 },
};

const pickNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const normalizeUsage = (usage: Record<string, unknown>): TokenUsage => {
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
        const value = pickNumber(candidate[key]);
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
    cachedInputTokens: extract([
      "cachedInputTokens",
      "cached_input_tokens",
    ]),
  };
};

const lookupPricing = (
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

const resolveTokenPricing = (
  provider: AiProvider,
  modelId?: string
): TokenPricingConfig | undefined => {
  const providerKey = provider.toLowerCase();
  const modelKey = modelId?.toLowerCase();

  const keys: string[] = [];
  if (modelKey) {
    keys.push(`${providerKey}:${modelKey}`, modelKey);
  }
  keys.push(providerKey);

  const override = lookupPricing([env.aiTokenPricing], keys);
  if (override) {
    return override;
  }

  return lookupPricing([DEFAULT_TOKEN_PRICING], keys);
};

const calculateUsageCost = (
  provider: AiProvider,
  modelId: string | undefined,
  usage: TokenUsage
): number | undefined => {
  const pricing = resolveTokenPricing(provider, modelId);
  if (!pricing) {
    return undefined;
  }

  const rate = (
    tokens: number | undefined,
    pricePerThousand: number | undefined,
    fallback?: number
  ): number => {
    if (!tokens || tokens <= 0) {
      return 0;
    }
    const rateToUse =
      pricePerThousand ??
      fallback ??
      0;
    if (rateToUse <= 0) {
      return 0;
    }
    return (tokens / 1000) * rateToUse;
  };

  const inputCost = rate(usage.inputTokens, pricing.input);
  const outputCost = rate(usage.outputTokens, pricing.output);
  const reasoningCost = rate(
    usage.reasoningTokens,
    pricing.reasoning,
    pricing.output ?? pricing.input
  );
  const cachedCost = rate(
    usage.cachedInputTokens,
    pricing.cachedInput,
    pricing.input
  );

  const total = inputCost + outputCost + reasoningCost + cachedCost;
  return total > 0 ? total : undefined;
};

interface RunAgentConfig<T> {
  agent: AgentIdentifier;
  provider: AiProvider;
  messages: CoreMessage[];
  parser: (text: string) => T;
  overrides?: AiCallOverrides;
  loggerScope: ReturnType<typeof createLogger>;
  timings: SeoWorkflowTiming[];
  models: Record<string, string>;
  usageSummary: UsageAccumulator;
}

const runAgentCall = async <T>({
  agent,
  provider,
  messages,
  parser,
  overrides,
  loggerScope,
  timings,
  models,
  usageSummary,
}: RunAgentConfig<T>): Promise<T> => {
  const mergedOverrides = {
    ...agentDefaults[agent],
    ...(overrides ?? {}),
  };

  const { result, durationMs } = await loggerScope.measure(
    agent,
    async (): Promise<GenerateAiTextResult> => {
      const callOptions: GenerateAiTextOptions = {
        provider,
        messages,
      };

      if (typeof mergedOverrides.model === "string") {
        callOptions.model = mergedOverrides.model;
      }

      if (typeof mergedOverrides.temperature === "number") {
        callOptions.temperature = mergedOverrides.temperature;
      }

      if (typeof mergedOverrides.maxTokens === "number") {
        callOptions.maxTokens = mergedOverrides.maxTokens;
      }

      if (provider === "gemini" && agent === "factsResearcher") {
        callOptions.tools = createGeminiTools();
      }

      if (typeof mergedOverrides.reasoningEffort === "string") {
        callOptions.reasoningEffort = mergedOverrides.reasoningEffort;
      }

      return generateAiText(callOptions);
    }
  );

  timings.push({
    step: agent,
    durationMs: Number(durationMs.toFixed(2)),
  });

  const modelInfo = collectModelId(agent, provider, result, models);
  const usageData = normalizeUsage(
    (result.usage ?? {}) as Record<string, unknown>
  );
  const costUsd = calculateUsageCost(provider, modelInfo.modelId, usageData);

  const breakdownEntry: UsageBreakdownEntry = {
    agent,
    provider,
    model: modelInfo.identifier,
    modelId: modelInfo.modelId,
    ...usageData,
  };

  if (typeof costUsd === "number") {
    breakdownEntry.costUsd = costUsd;
    usageSummary.totalCostUsd += costUsd;
  }

  usageSummary.breakdown.push(breakdownEntry);

  const rawText = result.text ?? "";
  loggerScope.debug(`${agent}::rawTextPreview`, {
    preview: rawText.slice(0, 200),
    totalChars: rawText.length,
  });

  try {
    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      loggerScope.warn(`${agent}::emptyResponse`, {
        message: "Agent returned empty response; injecting empty JSON object.",
      });
      return parser("{}");
    }
    return parser(trimmed);
  } catch (error) {
    if (error instanceof JsonParseError) {
      loggerScope.error(`${agent}::parsingFailed`, {
        message: error.message,
        details: error.original,
      });
    }
    throw error;
  }
};

const selectProviderForAgent = (
  agent: AgentIdentifier,
  baseProvider: AiProvider
): AiProvider => {
  if (agent === "factsResearcher") {
    return "gemini";
  }
  if (agent === "blogWeaver") {
    return "openai";
  }
  return baseProvider;
};

const prepareOverrides = (
  agent: AgentIdentifier,
  overrides?: SeoWorkflowOptions["overrides"]
): AiCallOverrides | undefined => overrides?.[agent];

const sanitizeFact = (candidate: unknown): ResearchFact => {
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
    conflict:
      typeof entry.conflict === "boolean" ? entry.conflict : false,
  };
};

const sanitizePaaQuestion = (
  candidate: unknown
): PeopleAlsoAskQuestion => {
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

const parseFactsResponse = (text: string): AgentFactsResult => {
  const parsed = parseJson<Partial<AgentFactsResult>>(text);
  const facts = Array.isArray(parsed.facts)
    ? parsed.facts
        .map(sanitizeFact)
        .filter((fact) => fact.fact.trim().length > 0)
    : [];
  const paa_questions = Array.isArray(parsed.paa_questions)
    ? parsed.paa_questions
        .map(sanitizePaaQuestion)
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

export const runSeoWorkflow = async (
  options: SeoWorkflowOptions
): Promise<SeoWorkflowResult> => {
  const context = normalizeContextRows(options.context);
  const baseProvider: AiProvider = options.provider ?? DEFAULT_PROVIDER;
  const logger = createLogger(`SEO_WORKFLOW:${context.blog_topic}`);

  const timings: SeoWorkflowTiming[] = [];
  const models: Record<string, string> = {};
  const usageSummary: UsageAccumulator = {
    breakdown: [],
    totalCostUsd: 0,
  };

  let textrazorInsights: TextRazorInsights;

  try {
    const start = Date.now();
    textrazorInsights = await analyzeContextWithTextRazor(context);
    const duration = Date.now() - start;
    timings.push({
      step: "textrazor",
      durationMs: Number(duration.toFixed(2)),
    });
  } catch (error) {
    if (error instanceof TextRazorError) {
      logger.error("textrazor_failed", { message: error.message });
    }
    throw error;
  }

  const overrides = options.overrides ?? {};
  const factsOverrides = prepareOverrides("factsResearcher", overrides);

  let facts: AgentFactsResult = { facts: [], paa_questions: [], warnings: [] };

  try {
    facts = await runAgentCall<AgentFactsResult>({
      agent: "factsResearcher",
      provider: selectProviderForAgent("factsResearcher", "gemini"),
      messages: buildMessages(SEO_AGENT_PROMPTS[promptKeys.factsResearcher], {
        context,
        textrazor: textrazorInsights,
      }),
      parser: parseFactsResponse,
      ...(factsOverrides ? { overrides: factsOverrides } : {}),
      loggerScope: logger,
      timings,
      models,
      usageSummary,
    });
  } catch (error) {
    logger.warn("facts_fetch_failed", {
      message:
        error instanceof Error ? error.message : "Unknown facts fetch error",
    });
  }

  const blogInputOptions: BuildBlogWeaverInputOptions = {};
  if (
    typeof options.audienceOverride === "string" &&
    options.audienceOverride.trim().length > 0
  ) {
    blogInputOptions.audienceOverride = options.audienceOverride.trim();
  }
  if (
    typeof options.brandVoiceOverride === "string" &&
    options.brandVoiceOverride.trim().length > 0
  ) {
    blogInputOptions.brandVoiceOverride = options.brandVoiceOverride.trim();
  }
  if (
    typeof options.localeOverride === "string" &&
    options.localeOverride.trim().length > 0
  ) {
    blogInputOptions.locale = options.localeOverride.trim();
  }
  if (typeof options.ymyl === "boolean") {
    blogInputOptions.ymyl = options.ymyl;
  }
  if (options.publishMode === "draft" || options.publishMode === "publish") {
    blogInputOptions.publishMode = options.publishMode;
  }

  const blogInput: BlogWeaverInput = buildBlogWeaverInput(
    context,
    textrazorInsights,
    facts,
    options.siteStructure,
    blogInputOptions
  );

  const blogOverrides = prepareOverrides("blogWeaver", overrides);

  const draft = await runAgentCall<string>({
    agent: "blogWeaver",
    provider: selectProviderForAgent("blogWeaver", baseProvider),
    messages: buildMessages(SEO_AGENT_PROMPTS[promptKeys.blogWeaver], blogInput),
    parser: (text) => text.trim(),
    ...(blogOverrides ? { overrides: blogOverrides } : {}),
    loggerScope: logger,
    timings,
    models,
    usageSummary,
  });

  const formattedBreakdown = usageSummary.breakdown.map((entry) => ({
    ...entry,
    ...(typeof entry.costUsd === "number"
      ? { costUsd: Number(entry.costUsd.toFixed(6)) }
      : {}),
  }));

  logger.info("llm_cost_summary", {
    totalUsd: Number(usageSummary.totalCostUsd.toFixed(6)),
    breakdown: formattedBreakdown,
  });

  const outputs: SeoWorkflowOutputs = {
    textrazor: textrazorInsights,
    facts,
    blogInput,
    draft,
  };

  return {
    context,
    ...(options.siteStructure ? { siteStructure: options.siteStructure } : {}),
    outputs,
    timings,
    provider: baseProvider,
    models,
  };
};
