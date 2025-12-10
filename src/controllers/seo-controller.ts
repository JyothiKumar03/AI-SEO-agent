import { Request, Response } from "express";
import { run_seo_workflow } from "../workflows/seo-workflow";
import type { AiCallOverrides, AiProvider } from "../types/ai";
import type {
  AgentIdentifier,
  HeadingTag,
  SeoAgentContext,
  SeoContextRow,
  SiteStructure,
  SeoWorkflowOptions,
} from "../types/seo";

type UnknownRecord = Record<string, unknown>;

const allowed_providers: AiProvider[] = ["openai", "anthropic", "gemini"];

const is_heading_tag = (value: unknown): value is HeadingTag => {
  if (typeof value !== "string") {
    return false;
  }

  return value === "h1" || value === "h2" || value === "h3";
};

const normalize_row = (input: unknown, index: number): SeoContextRow => {
  if (!input || typeof input !== "object") {
    throw new Error(`Row at index ${index} must be an object.`);
  }

  const candidate = input as UnknownRecord;
  const order = candidate.order;
  const heading_tag =
    candidate.heading_tag ?? candidate.headingTag ?? candidate.tag;
  const content = candidate.content;

  if (typeof order !== "number" || !Number.isFinite(order)) {
    throw new Error(`Row at index ${index} requires a numeric "order".`);
  }

  if (!is_heading_tag(heading_tag)) {
    throw new Error(
      `Row at index ${index} requires "heading_tag" of "h1", "h2", or "h3".`
    );
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(`Row at index ${index} requires non-empty "content".`);
  }

  return {
    order,
    heading_tag,
    content: content.trim(),
  };
};

const normalize_context = (input: unknown): SeoAgentContext => {
  if (!input || typeof input !== "object") {
    throw new Error("context must be an object.");
  }

  const candidate = input as UnknownRecord;
  const blog_topic =
    candidate.blog_topic ??
    candidate.blogTopic ??
    candidate.topic ??
    candidate.title;
  const blog_url_candidate =
    candidate.blog_url ??
    candidate.sample_blog_url ??
    candidate.blogUrl ??
    candidate.sampleBlogUrl;
  const raw_rows = candidate.rows;

  if (typeof blog_topic !== "string" || blog_topic.trim().length === 0) {
    throw new Error('context requires "blog_topic" as a non-empty string.');
  }

  let blog_url: string | undefined;
  if (typeof blog_url_candidate === "string") {
    const trimmed = blog_url_candidate.trim();
    if (trimmed.length > 0) {
      blog_url = trimmed;
    }
  }

  if (!Array.isArray(raw_rows) || raw_rows.length === 0) {
    throw new Error('context requires a non-empty "rows" array.');
  }

  const rows = raw_rows.map((row, index) => normalize_row(row, index));

  const context: SeoAgentContext = {
    blog_topic: blog_topic.trim(),
    rows,
  };

  if (blog_url) {
    context.blog_url = blog_url;
  }

  return context;
};

const normalize_site_structure = (
  input: unknown
): SiteStructure | undefined => {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const available_slugs_raw =
    candidate.available_slugs ?? candidate.availableSlugs;
  const external_whitelist_raw =
    candidate.external_whitelist ?? candidate.externalWhitelist;

  const available_slugs = Array.isArray(available_slugs_raw)
    ? available_slugs_raw.filter(
        (slug): slug is string => typeof slug === "string"
      )
    : [];

  const external_whitelist = Array.isArray(external_whitelist_raw)
    ? external_whitelist_raw.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];

  if (available_slugs.length === 0 && external_whitelist.length === 0) {
    return undefined;
  }

  return {
    available_slugs,
    external_whitelist,
  };
};

const normalize_provider = (input: unknown): AiProvider | undefined => {
  if (typeof input !== "string") {
    return undefined;
  }

  if (allowed_providers.includes(input as AiProvider)) {
    return input as AiProvider;
  }

  throw new Error(
    `Unsupported provider "${input}". Allowed providers: ${allowed_providers.join(
      ", "
    )}`
  );
};

const normalize_overrides = (
  input: unknown
): SeoWorkflowOptions["overrides"] | undefined => {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const result: Partial<Record<AgentIdentifier, AiCallOverrides>> = {};
  const allowed_agents: AgentIdentifier[] = ["factsResearcher", "blogWeaver"];

  for (const [agent_key, raw_override] of Object.entries(
    input as Record<string, unknown>
  )) {
    if (
      !allowed_agents.includes(agent_key as AgentIdentifier) ||
      !raw_override ||
      typeof raw_override !== "object"
    ) {
      continue;
    }

    const override_record = raw_override as Record<string, unknown>;
    const normalized: AiCallOverrides = {};

    if (typeof override_record.model === "string") {
      normalized.model = override_record.model;
    }
    if (typeof override_record.temperature === "number") {
      normalized.temperature = override_record.temperature;
    }
    if (typeof override_record.max_tokens === "number") {
      normalized.max_tokens = override_record.max_tokens;
    } else if (typeof override_record.maxTokens === "number") {
      normalized.max_tokens = override_record.maxTokens;
    }

    const reasoning_effort =
      override_record.reasoning_effort ?? override_record.reasoningEffort;
    if (
      reasoning_effort === "low" ||
      reasoning_effort === "medium" ||
      reasoning_effort === "high"
    ) {
      normalized.reasoning_effort = reasoning_effort;
    }

    if (Object.keys(normalized).length > 0) {
      result[agent_key as AgentIdentifier] = normalized;
    }
  }

  return Object.keys(result).length > 0
    ? (result as SeoWorkflowOptions["overrides"])
    : undefined;
};

const build_workflow_options = (body: UnknownRecord): SeoWorkflowOptions => {
  if (!("context" in body)) {
    throw new Error('Request body requires "context".');
  }

  const context = normalize_context(body.context);
  const provider = normalize_provider(body.provider);

  const overrides = body.overrides;
  const site_structure = normalize_site_structure(
    "site_structure" in body ? body.site_structure : body.siteStructure
  );

  const options: SeoWorkflowOptions = {
    context,
  };

  if (provider) {
    options.provider = provider;
  }

  const normalized_overrides = normalize_overrides(overrides);
  if (normalized_overrides) {
    options.overrides = normalized_overrides;
  }

  if (site_structure) {
    options.siteStructure = site_structure;
  }

  return options;
};

export const generate_seo_content = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const options = build_workflow_options(req.body as UnknownRecord);
    const result = await run_seo_workflow(options);
    res.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate content.";
    res.status(400).json({
      error: message,
    });
  }
};
