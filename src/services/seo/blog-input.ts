import type {
  AgentFactsResult,
  BlogWeaverInput,
  NormalizedEntity,
  SeoAgentContext,
  SiteStructure,
  TextRazorInsights,
} from "../../types/seo";

const normalize_entity_type = (type: string): string => {
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

const pick_primary_keyword = (context: SeoAgentContext): string => {
  const h1 = context.rows.find((row) => row.heading_tag === "h1");
  return (h1?.content ?? context.blog_topic).trim();
};

const derive_secondary_keywords = (
  insights: TextRazorInsights,
  primary_keyword: string
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
    if (value.toLowerCase() === primary_keyword.toLowerCase()) {
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

const map_entities = (
  entities: NormalizedEntity[]
): Array<{ name: string; type: string }> => {
  return entities.slice(0, 20).map((entity) => ({
    name: entity.name,
    type: normalize_entity_type(entity.type),
  }));
};

const build_internal_links = (
  site_structure?: SiteStructure
): BlogWeaverInput["internal_links"] => {
  if (!site_structure || site_structure.available_slugs.length === 0) {
    return [];
  }

  return site_structure.available_slugs.slice(0, 3).map((slug) => {
    const normalized_slug = slug.startsWith("/") ? slug : `/${slug}`;
    const cleaned = slug
      .replace(/^\//, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const anchor =
      cleaned.length > 0
        ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase())
        : normalized_slug.replace("/", "").replace(/[-_]/g, " ");
    return {
      anchor: anchor.trim(),
      url: normalized_slug,
    };
  });
};

export interface BuildBlogWeaverInputOptions {
  audience_override?: string;
  brand_voice_override?: string;
  locale?: string;
  ymyl?: boolean;
  publish_mode?: "draft" | "publish";
}

export const build_blog_weaver_input = (
  context: SeoAgentContext,
  insights: TextRazorInsights,
  facts: AgentFactsResult,
  site_structure: SiteStructure | undefined,
  options: BuildBlogWeaverInputOptions = {}
): BlogWeaverInput => {
  const primary_keyword = pick_primary_keyword(context);

  const audience =
    options.audience_override ??
    `Readers exploring ${primary_keyword.toLowerCase()}`;

  const brand_voice =
    options.brand_voice_override ??
    "Warm, practical, confident subject-matter guide.";

  const locale = options.locale ?? "en-US";
  const ymyl = options.ymyl ?? false;
  const publish_mode = options.publish_mode ?? "draft";

  return {
    title: context.blog_topic.trim(),
    audience,
    brand_voice,
    primary_keyword,
    secondary_keywords: derive_secondary_keywords(insights, primary_keyword),
    locale,
    ymyl,
    publish_mode,
    entities: map_entities(insights.entities),
    ngrams: insights.ngrams,
    outline: context.rows.map((row) => ({
      tag: row.heading_tag,
      text: row.content.trim(),
    })),
    competitors: [],
    facts: facts.facts ?? [],
    paa_questions: facts.paa_questions ?? [],
    internal_links: build_internal_links(site_structure),
  };
};
