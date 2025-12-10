import { env } from "../../config/env";
import { create_logger } from "../../utils/logger";
import type {
  NormalizedEntity,
  SeoAgentContext,
  TextRazorInsights,
} from "../../types/seo";

const TEXTRAZOR_ENDPOINT = "https://api.textrazor.com/";
const logger = create_logger("TEXTRAZOR");

interface TextRazorEntity {
  entityId?: string;
  matchedText?: string;
  type?: string[];
  relevanceScore?: number;
  confidenceScore?: number;
  wikiLink?: string;
}

interface TextRazorPhrase {
  text?: string;
  score?: number;
}

interface TextRazorTopic {
  label?: string;
  score?: number;
}

interface TextRazorResponseBody {
  response?: {
    entities?: TextRazorEntity[];
    phrases?: TextRazorPhrase[];
    topics?: TextRazorTopic[];
  };
  error?: string;
  ok?: boolean;
}

export class TextRazorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextRazorError";
  }
}

const build_body_text = (context: SeoAgentContext): string => {
  const parts = [context.blog_topic, ...context.rows.map((row) => row.content)];
  return parts.join("\n").trim();
};

const unique_by = <T, K>(items: T[], selector: (item: T) => K): T[] => {
  const seen = new Set<K>();
  const result: T[] = [];
  for (const item of items) {
    const key = selector(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
};

export const analyze_context_with_textrazor = async (
  context: SeoAgentContext
): Promise<TextRazorInsights> => {
  const api_key = env.textRazorApiKey;
  if (!api_key) {
    throw new TextRazorError(
      "TEXT_RAZOR_API_KEY is required to analyze entities before AI calls."
    );
  }

  const text = build_body_text(context);
  if (text.length === 0) {
    throw new TextRazorError("Context rows must include content for TextRazor.");
  }

  const params = new URLSearchParams();
  params.set("extractors", "entities,topics,relations,phrases,entailments");
  params.set("cleanup.mode", "stripTags");
  params.set("languageOverride", "eng");
  params.set("text", text);

  let response: Response;

  try {
    response = await fetch(TEXTRAZOR_ENDPOINT, {
      method: "POST",
      headers: {
        "X-TextRazor-Key": api_key,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch (error) {
    logger.error("request_failed", {
      message:
        error instanceof Error ? error.message : "Unknown TextRazor error",
    });
    throw new TextRazorError("Failed to reach TextRazor API.");
  }

  if (!response.ok) {
    const response_text = await response.text().catch(() => "unknown error");
    logger.error("response_not_ok", {
      status: response.status,
      statusText: response.statusText,
      body: response_text,
    });
    throw new TextRazorError(
      `TextRazor request failed with status ${response.status}.`
    );
  }

  let body: TextRazorResponseBody;
  try {
    body = (await response.json()) as TextRazorResponseBody;
  } catch (error) {
    logger.error("parsing_failed", {
      message:
        error instanceof Error ? error.message : "Unknown JSON parse error",
    });
    throw new TextRazorError("Failed to parse TextRazor response.");
  }

  if (body.error) {
    logger.error("textrazor_error", { error: body.error });
    throw new TextRazorError(`TextRazor error: ${body.error}`);
  }

  const entities_raw = body.response?.entities ?? [];
  const phrases_raw = body.response?.phrases ?? [];
  const topics_raw = body.response?.topics ?? [];

  const normalized_entities = unique_by(
    entities_raw
      .map<NormalizedEntity | null>((entity) => {
        const name =
          entity.entityId ??
          entity.matchedText ??
          entity.type?.[0] ??
          undefined;
        if (!name) {
          return null;
        }
        const type = entity.type?.[0] ?? "entity";
        const relevance =
          typeof entity.relevanceScore === "number"
            ? Number(entity.relevanceScore.toFixed(3))
            : 0;
        const confidence =
          typeof entity.confidenceScore === "number"
            ? Number(entity.confidenceScore.toFixed(3))
            : 0;
        const normalized: NormalizedEntity = {
          name,
          type,
          relevance,
          confidence,
        };
        if (entity.wikiLink) {
          normalized.sourceUrl = entity.wikiLink;
        }
        return normalized;
      })
      .filter((item): item is NormalizedEntity => item !== null),
    (item) => item.name.toLowerCase()
  ).slice(0, 24);

  const ngrams = unique_by(
    phrases_raw
      .map((phrase) => (phrase.text ?? "").trim())
      .filter((text) => {
        if (!text) {
          return false;
        }
        const word_count = text.split(/\s+/).length;
        return word_count >= 2 && word_count <= 6;
      }),
    (text) => text.toLowerCase()
  ).slice(0, 30);

  const topics = unique_by(
    topics_raw
      .map((topic) => (topic.label ?? "").trim())
      .filter((label) => label.length > 0),
    (label) => label.toLowerCase()
  ).slice(0, 20);

  const insights: TextRazorInsights = {
    entities: normalized_entities,
    ngrams,
    topics,
  };

  if (env.nodeEnv !== "production") {
    insights.raw = body.response;
  }

  return insights;
};
