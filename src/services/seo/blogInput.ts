import type {
  AgentFactsResult,
  BlogWeaverInput,
  NormalizedEntity,
  SeoAgentContext,
  SiteStructure,
  TextRazorInsights,
} from "./types";

const normalizeEntityType = (type: string): string => {
  const normalized = type.toLowerCase();
  if (normalized.includes("person")) {
    return "person";
  }
  if (
    normalized.includes("organisation") ||
    normalized.includes("organization") ||
    normalized.includes("company") ||
    normalized.includes("brand")
  ) {
    return "org";
  }
  if (normalized.includes("topic") || normalized.includes("concept")) {
    return "topic";
  }
  return "thing";
};

const pickPrimaryKeyword = (context: SeoAgentContext): string => {
  const h1 = context.rows.find((row) => row.heading_tag === "h1");
  return (h1?.content ?? context.blog_topic).trim();
};

const deriveSecondaryKeywords = (
  insights: TextRazorInsights,
  primaryKeyword: string
): string[] => {
  const candidates = [
    ...insights.topics,
    ...insights.entities.map((entity) => entity.name),
  ];
  const unique: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value) {
      continue;
    }
    if (value.toLowerCase() === primaryKeyword.toLowerCase()) {
      continue;
    }
    if (!unique.some((item) => item.toLowerCase() === value.toLowerCase())) {
      unique.push(value);
    }
    if (unique.length >= 12) {
      break;
    }
  }
  return unique;
};

const mapEntities = (entities: NormalizedEntity[]): Array<{
  name: string;
  type: string;
}> => {
  return entities.slice(0, 20).map((entity) => ({
    name: entity.name,
    type: normalizeEntityType(entity.type),
  }));
};

const buildInternalLinks = (
  siteStructure?: SiteStructure
): BlogWeaverInput["internal_links"] => {
  if (!siteStructure || siteStructure.available_slugs.length === 0) {
    return [];
  }

  return siteStructure.available_slugs.slice(0, 3).map((slug) => {
    const normalizedSlug = slug.startsWith("/") ? slug : `/${slug}`;
    const cleaned = slug
      .replace(/^\//, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const anchor =
      cleaned.length > 0
        ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase())
        : normalizedSlug.replace("/", "").replace(/[-_]/g, " ");
    return {
      anchor: anchor.trim(),
      url: normalizedSlug,
    };
  });
};

export interface BuildBlogWeaverInputOptions {
  audienceOverride?: string;
  brandVoiceOverride?: string;
  locale?: string;
  ymyl?: boolean;
  publishMode?: "draft" | "publish";
}

export const buildBlogWeaverInput = (
  context: SeoAgentContext,
  insights: TextRazorInsights,
  facts: AgentFactsResult,
  siteStructure: SiteStructure | undefined,
  options: BuildBlogWeaverInputOptions = {}
): BlogWeaverInput => {
  const primaryKeyword = pickPrimaryKeyword(context);

  const audience =
    options.audienceOverride ??
    `Readers exploring ${primaryKeyword.toLowerCase()}`;

  const brandVoice =
    options.brandVoiceOverride ??
    "Warm, practical, confident subject-matter guide.";

  const locale = options.locale ?? "en-US";
  const ymyl = options.ymyl ?? false;
  const publishMode = options.publishMode ?? "draft";

  return {
    title: context.blog_topic.trim(),
    audience,
    brand_voice: brandVoice,
    primary_keyword: primaryKeyword,
    secondary_keywords: deriveSecondaryKeywords(insights, primaryKeyword),
    locale,
    ymyl,
    publish_mode: publishMode,
    entities: mapEntities(insights.entities),
    ngrams: insights.ngrams,
    outline: context.rows.map((row) => ({
      tag: row.heading_tag,
      text: row.content.trim(),
    })),
    competitors: [],
    facts: facts.facts ?? [],
    paa_questions: facts.paa_questions ?? [],
    internal_links: buildInternalLinks(siteStructure),
  };
};
