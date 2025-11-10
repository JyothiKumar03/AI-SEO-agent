import { config } from "dotenv";

config();

const parsePort = (value: string | undefined, fallback = 3000): number => {
  const port = Number(value);

  if (Number.isFinite(port) && port > 0) {
    return port;
  }

  return fallback;
};

export interface TokenPricingConfig {
  input?: number;
  output?: number;
  reasoning?: number;
  cachedInput?: number;
}

const parseTokenPricing = (
  value: string | undefined,
): Record<string, TokenPricingConfig> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const result: Record<string, TokenPricingConfig> = {};
    for (const [key, pricing] of Object.entries(parsed as Record<string, unknown>)) {
      if (!key || typeof key !== "string" || !pricing || typeof pricing !== "object") {
        continue;
      }

      const normalizedKey = key.toLowerCase();
      const pricingRecord = pricing as Record<string, unknown>;
      const entry: TokenPricingConfig = {};

      const maybeNumber = (candidate: unknown): number | undefined => {
        return typeof candidate === "number" && Number.isFinite(candidate)
          ? candidate
          : undefined;
      };

      const input = maybeNumber(pricingRecord.input ?? pricingRecord.prompt);
      const output = maybeNumber(pricingRecord.output ?? pricingRecord.completion);
      const reasoning = maybeNumber(pricingRecord.reasoning);
      const cachedInput = maybeNumber(pricingRecord.cached ?? pricingRecord.cachedInput);

      if (
        input === undefined &&
        output === undefined &&
        reasoning === undefined &&
        cachedInput === undefined
      ) {
        continue;
      }

      if (input !== undefined) {
        entry.input = input;
      }
      if (output !== undefined) {
        entry.output = output;
      }
      if (reasoning !== undefined) {
        entry.reasoning = reasoning;
      }
      if (cachedInput !== undefined) {
        entry.cachedInput = cachedInput;
      }

      result[normalizedKey] = entry;
    }

    return result;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Failed to parse AI token pricing overrides.", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePort(process.env.PORT),
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  geminiApiKey:
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY,
  textRazorApiKey: process.env.TEXT_RAZOR_API_KEY,
  aiTokenPricing: parseTokenPricing(process.env.AI_TOKEN_PRICING),
};

export const isProduction = env.nodeEnv === "production";
