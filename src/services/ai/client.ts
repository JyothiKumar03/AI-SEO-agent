import { createAnthropic } from "@ai-sdk/anthropic";
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { env } from "../../config/env";
import type {
  AiCallConfig,
  AiCallResult,
  AiProvider,
  AiToolSet,
} from "../../types/ai";

type OpenAiProvider = ReturnType<typeof createOpenAI>;
type AnthropicProvider = ReturnType<typeof createAnthropic>;
type GeminiProvider = GoogleGenerativeAIProvider;

type ProviderInstance = OpenAiProvider | AnthropicProvider | GeminiProvider;

const default_models: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.5-pro",
};

const require_key = (name: string, value?: string): string => {
  if (!value) {
    throw new AiClientError(`Missing required environment variable "${name}".`, {
      variable: name,
    });
  }
  return value;
};

const provider_factories: Record<AiProvider, () => ProviderInstance> = {
  openai: () =>
    createOpenAI({
      apiKey: require_key("OPENAI_API_KEY", env.openaiApiKey),
    }),
  anthropic: () =>
    createAnthropic({
      apiKey: require_key("ANTHROPIC_API_KEY", env.anthropicApiKey),
    }),
  gemini: () =>
    createGoogleGenerativeAI({
      apiKey: require_key(
        "GOOGLE_GENERATIVE_AI_API_KEY",
        env.geminiApiKey
      ),
    }),
};

const provider_cache = new Map<AiProvider, ProviderInstance>();

const get_provider_instance = (provider: AiProvider): ProviderInstance => {
  if (!provider_cache.has(provider)) {
    provider_cache.set(provider, provider_factories[provider]());
  }
  return provider_cache.get(provider)!;
};

const normalize_tool_set = (
  tool_set?: AiToolSet
): Record<string, unknown> | undefined => {
  if (!tool_set) {
    return undefined;
  }

  const normalized: Record<string, unknown> = {};

  for (const [tool_name, tool_definition] of Object.entries(tool_set)) {
    normalized[tool_name] = {
      ...(tool_definition.execute
        ? { execute: tool_definition.execute }
        : {}),
      ...(tool_definition.description
        ? { description: tool_definition.description }
        : {}),
      inputSchema: tool_definition.input_schema,
    };
  }

  return normalized;
};

const build_gemini_tools = (
  tool_set: AiToolSet | undefined,
  provider_instance: GeminiProvider
): Record<string, unknown> => {
  const normalized_custom = normalize_tool_set(tool_set) ?? {};

  return {
    google_grounding: provider_instance.tools.googleSearch({}),
    url_context: provider_instance.tools.urlContext({}),
    ...normalized_custom,
  };
};

const resolve_tools = (
  tool_set: AiToolSet | undefined,
  provider: AiProvider,
  provider_instance: ProviderInstance
): Record<string, unknown> | undefined => {
  if (provider === "gemini") {
    return build_gemini_tools(tool_set, provider_instance as GeminiProvider);
  }

  return normalize_tool_set(tool_set);
};

export class AiClientError extends Error {
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown>, options?: { cause?: Error }) {
    super(message);
    this.name = "AiClientError";
    this.context = context;
    if (options?.cause) {
      (this as Error & { cause?: Error }).cause = options.cause;
    }
  }
}

export const call_ai_model = async <OutputShape = unknown>(
  config: AiCallConfig<OutputShape>
): Promise<AiCallResult<OutputShape>> => {
  const {
    provider,
    model_name,
    system_prompt,
    prompt,
    messages,
    temperature,
    max_tokens,
    tools,
    tool_choice,
    reasoning_effort,
    output_schema,
  } = config;

  if (!prompt && (!messages || messages.length === 0)) {
    throw new AiClientError(
      "Either `prompt` or `messages` must be provided to call the AI model.",
      { provider }
    );
  }

  const provider_instance = get_provider_instance(provider);
  const model_identifier = model_name ?? default_models[provider];

  type GenerateTextParameters = Parameters<typeof generateText>[0];

  const model_builder =
    provider === "openai"
      ? (provider_instance as OpenAiProvider)
      : provider === "anthropic"
        ? (provider_instance as AnthropicProvider)
        : (provider_instance as GeminiProvider);

  const call_options: Record<string, unknown> = {
    model: model_builder(model_identifier),
  };

  if (system_prompt) {
    call_options.system = system_prompt;
  }

  if (messages && messages.length > 0) {
    call_options.messages = messages;
  } else if (prompt) {
    call_options.prompt = prompt;
  }

  if (typeof temperature === "number") {
    call_options.temperature = temperature;
  }

  if (typeof max_tokens === "number") {
    call_options.maxOutputTokens = max_tokens;
  }

  const resolved_tools = resolve_tools(tools, provider, provider_instance);
  if (resolved_tools && Object.keys(resolved_tools).length > 0) {
    call_options.tools = resolved_tools;
  }

  if (tool_choice) {
    call_options.toolChoice = tool_choice;
  }

  if (provider === "openai" && reasoning_effort) {
    call_options.reasoning = {
      effort: reasoning_effort,
    };
  }

  if (output_schema) {
    call_options.experimental_output = Output.object({ schema: output_schema });
  }

  let response: Awaited<ReturnType<typeof generateText>>;

  try {
    response = await generateText(call_options as GenerateTextParameters);
  } catch (error) {
    const base_context = { provider, model_identifier };
    if (error instanceof Error) {
      throw new AiClientError(
        `AI provider "${provider}" request failed: ${error.message}`,
        { ...base_context, original_message: error.message },
        { cause: error }
      );
    }

    throw new AiClientError(
      `AI provider "${provider}" request failed.`,
      { ...base_context, original_message: String(error) }
    );
  }

  const parsed_output = output_schema
    ? (response.experimental_output as OutputShape | undefined)
    : undefined;

  const base_result: Omit<AiCallResult<OutputShape>, "parsed_output"> = {
    text: response.text,
    finish_reason: response.finishReason ?? "unknown",
    usage:
      (response.usage as Record<string, unknown>) ??
      (response.totalUsage as Record<string, unknown>) ??
      {},
    raw_response: response,
  };

  return parsed_output !== undefined
    ? { ...base_result, parsed_output }
    : base_result;
};
