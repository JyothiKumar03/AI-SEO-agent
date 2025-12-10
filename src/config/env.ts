import { config } from "dotenv";

config();

const parse_port = (value: string | undefined, fallback = 3000): number => {
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

const parse_token_pricing = (
  value: string | undefined
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
    for (const [key, pricing] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (
        !key ||
        typeof key !== "string" ||
        !pricing ||
        typeof pricing !== "object"
      ) {
        continue;
      }

      const normalized_key = key.toLowerCase();
      const pricing_record = pricing as Record<string, unknown>;
      const entry: TokenPricingConfig = {};

      const maybe_number = (candidate: unknown): number | undefined => {
        return typeof candidate === "number" && Number.isFinite(candidate)
          ? candidate
          : undefined;
      };

      const input = maybe_number(pricing_record.input ?? pricing_record.prompt);
      const output = maybe_number(
        pricing_record.output ?? pricing_record.completion
      );
      const reasoning = maybe_number(pricing_record.reasoning);
      const cached_input = maybe_number(
        pricing_record.cached ?? pricing_record.cachedInput
      );

      if (
        input === undefined &&
        output === undefined &&
        reasoning === undefined &&
        cached_input === undefined
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
      if (cached_input !== undefined) {
        entry.cachedInput = cached_input;
      }

      result[normalized_key] = entry;
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
  port: parse_port(process.env.PORT),
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  geminiApiKey:
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY,
  textRazorApiKey: process.env.TEXT_RAZOR_API_KEY,
  aiTokenPricing: parse_token_pricing(process.env.AI_TOKEN_PRICING),
};

export const is_production = env.nodeEnv === "production";
export const isProduction = is_production;
