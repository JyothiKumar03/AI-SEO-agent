import { generateText, type CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { env } from "../config/env";
import { z } from "zod";

type AiProvider = "openai" | "anthropic" | "gemini";

type OpenAiProvider = ReturnType<typeof createOpenAI>;
type AnthropicProvider = ReturnType<typeof createAnthropic>;
type GeminiProvider = GoogleGenerativeAIProvider;

type ProviderInstance = OpenAiProvider | AnthropicProvider | GeminiProvider;

type ToolSet = Record<
  string,
  {
    execute?: (...args: any[]) => any;
    inputSchema: z.ZodType<any>;
    description?: string;
  }
>;

type ReasoningEffort = "low" | "medium" | "high";

interface GenerateAiTextOptions {
  provider: AiProvider;
  model?: string;
  prompt?: string;
  messages?: CoreMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSet;
  reasoningEffort?: ReasoningEffort;
}

interface GenerateAiTextResult {
  text: string;
  usage: Record<string, unknown>;
  finishReason: string;
  rawResponse: Awaited<ReturnType<typeof generateText>>;
}

const defaultModels: Record<AiProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.5-pro",
};

const providerFactories: Record<AiProvider, () => ProviderInstance> = {
  openai: () =>
    createOpenAI({
      apiKey: requireKey("OPENAI_API_KEY", env.openaiApiKey),
    }),
  anthropic: () =>
    createAnthropic({
      apiKey: requireKey("ANTHROPIC_API_KEY", env.anthropicApiKey),
    }),
  gemini: () =>
    createGoogleGenerativeAI({
      apiKey: requireKey("GOOGLE_GENERATIVE_AI_API_KEY", env.geminiApiKey),
    }),
};

const providerCache = new Map<AiProvider, ProviderInstance>();

const getProviderInstance = (provider: AiProvider): ProviderInstance => {
  if (!providerCache.has(provider)) {
    providerCache.set(provider, providerFactories[provider]());
  }

  return providerCache.get(provider)!;
};

export const generateAiText = async (
  options: GenerateAiTextOptions
): Promise<GenerateAiTextResult> => {
  const {
    provider,
    model,
    prompt,
    messages,
    temperature,
    maxTokens,
    tools,
    reasoningEffort,
  } = options;

  if (!prompt && (!messages || messages.length === 0)) {
    throw new Error("Either `prompt` or `messages` must be provided.");
  }

  const providerInstance = getProviderInstance(provider);
  const selectedModel = model ?? defaultModels[provider];

  type GenerateTextParameters = Parameters<typeof generateText>[0];

  const callOptions = {
    model: providerInstance(selectedModel),
  } as GenerateTextParameters;

  if (messages && messages.length > 0) {
    callOptions.messages = messages;
  } else if (prompt) {
    callOptions.prompt = prompt;
  }

  if (typeof temperature === "number") {
    callOptions.temperature = temperature;
  }

  if (typeof maxTokens === "number") {
    callOptions.maxOutputTokens = maxTokens;
  }

  if (provider === "gemini") {
    const googleProvider = providerInstance as GeminiProvider;
    const remappedTools: Record<string, unknown> = {
      google_grounding: googleProvider.tools.googleSearch({}),
      url_context: googleProvider.tools.urlContext({}),
    };

    if (tools) {
      if ("google_grounding" in tools || "google_search" in tools) {
        remappedTools.google_grounding = googleProvider.tools.googleSearch({});
      }

      if ("url_context" in tools || "google_get_page_content" in tools) {
        remappedTools.url_context = googleProvider.tools.urlContext({});
      }
    }

    callOptions.tools = remappedTools as ToolSet;
  } else if (tools) {
    callOptions.tools = tools;
  }

  if (provider === "openai" && reasoningEffort) {
    (callOptions as Record<string, unknown>).reasoning = {
      effort: reasoningEffort,
    };
  }

  let result: Awaited<ReturnType<typeof generateText>>;

  try {
    result = await generateText(callOptions);
  } catch (error) {
    const baseContext = {
      provider,
      model: selectedModel,
    };

    if (error instanceof Error) {
      throw new AiClientError(
        `AI provider "${provider}" request failed: ${error.message}`,
        { ...baseContext, originalMessage: error.message },
        { cause: error }
      );
    }

    throw new AiClientError(`AI provider "${provider}" request failed.`, {
      ...baseContext,
      originalMessage: String(error),
    });
  }

  return {
    text: result.text,
    usage: result.usage ?? {},
    finishReason: result.finishReason ?? "unknown",
    rawResponse: result,
  };
};

const requireKey = (name: string, value?: string): string => {
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}" for AI provider.`
    );
  }

  return value;
};

class AiClientError extends Error {
  readonly context: Record<string, unknown>;
  readonly originalError: Error | undefined;

  constructor(
    message: string,
    context: Record<string, unknown>,
    options?: { cause?: Error }
  ) {
    super(message);
    this.name = "AiClientError";
    this.context = context;
    this.originalError = options?.cause;
  }
}

export type {
  AiProvider,
  GenerateAiTextOptions,
  GenerateAiTextResult,
  ToolSet,
};
export { AiClientError };
