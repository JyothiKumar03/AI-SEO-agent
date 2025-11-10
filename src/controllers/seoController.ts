import { Request, Response } from "express";
import { runSeoWorkflow } from "../services/seo/orchestrator";
import type { AiProvider } from "../services/aiClient";
import type {
  HeadingTag,
  SeoAgentContext,
  SeoContextRow,
  SiteStructure,
  SeoWorkflowOptions,
} from "../services/seo/types";

type UnknownRecord = Record<string, unknown>;

const allowedProviders: AiProvider[] = ["openai", "anthropic", "gemini"];

const isHeadingTag = (value: unknown): value is HeadingTag => {
  if (typeof value !== "string") {
    return false;
  }

  return value === "h1" || value === "h2" || value === "h3";
};

const normalizeRow = (input: unknown, index: number): SeoContextRow => {
  if (!input || typeof input !== "object") {
    throw new Error(`Row at index ${index} must be an object.`);
  }

  const candidate = input as UnknownRecord;
  const order = candidate.order;
  const headingTag =
    candidate.heading_tag ??
    candidate.headingTag ??
    candidate.tag;
  const content = candidate.content;

  if (typeof order !== "number" || !Number.isFinite(order)) {
    throw new Error(`Row at index ${index} requires a numeric "order".`);
  }

  if (!isHeadingTag(headingTag)) {
    throw new Error(
      `Row at index ${index} requires "heading_tag" of "h1", "h2", or "h3".`,
    );
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(`Row at index ${index} requires non-empty "content".`);
  }

  return {
    order,
    heading_tag: headingTag,
    content: content.trim(),
  };
};

const normalizeContext = (input: unknown): SeoAgentContext => {
  if (!input || typeof input !== "object") {
    throw new Error("context must be an object.");
  }

  const candidate = input as UnknownRecord;
  const blogTopic =
    candidate.blog_topic ??
    candidate.blogTopic ??
    candidate.topic ??
    candidate.title;
  const blogUrlCandidate =
    candidate.blog_url ??
    candidate.sample_blog_url ??
    candidate.blogUrl ??
    candidate.sampleBlogUrl;
  const rawRows = candidate.rows;

  if (typeof blogTopic !== "string" || blogTopic.trim().length === 0) {
    throw new Error('context requires "blog_topic" as a non-empty string.');
  }

  let blogUrl: string | undefined;
  if (typeof blogUrlCandidate === "string") {
    const trimmed = blogUrlCandidate.trim();
    if (trimmed.length > 0) {
      blogUrl = trimmed;
    }
  }

  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new Error('context requires a non-empty "rows" array.');
  }

  const rows = rawRows.map((row, index) => normalizeRow(row, index));

  const context: SeoAgentContext = {
    blog_topic: blogTopic.trim(),
    rows,
  };

  if (blogUrl) {
    context.blog_url = blogUrl;
  }

  return context;
};

const normalizeSiteStructure = (input: unknown): SiteStructure | undefined => {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as Record<string, unknown>;
  const availableSlugsRaw = candidate.available_slugs ?? candidate.availableSlugs;
  const externalWhitelistRaw =
    candidate.external_whitelist ?? candidate.externalWhitelist;

  const availableSlugs = Array.isArray(availableSlugsRaw)
    ? availableSlugsRaw.filter((slug): slug is string => typeof slug === "string")
    : [];

  const externalWhitelist = Array.isArray(externalWhitelistRaw)
    ? externalWhitelistRaw.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];

  if (availableSlugs.length === 0 && externalWhitelist.length === 0) {
    return undefined;
  }

  return {
    available_slugs: availableSlugs,
    external_whitelist: externalWhitelist,
  };
};

const normalizeProvider = (input: unknown): AiProvider | undefined => {
  if (typeof input !== "string") {
    return undefined;
  }

  if (allowedProviders.includes(input as AiProvider)) {
    return input as AiProvider;
  }

  throw new Error(
    `Unsupported provider "${input}". Allowed providers: ${allowedProviders.join(", ")}`,
  );
};

const buildWorkflowOptions = (body: UnknownRecord): SeoWorkflowOptions => {
  if (!("context" in body)) {
    throw new Error('Request body requires "context".');
  }

  const context = normalizeContext(body.context);
  const provider = normalizeProvider(body.provider);

  const overrides = body.overrides;
  const siteStructure = normalizeSiteStructure(
    "site_structure" in body ? body.site_structure : body.siteStructure,
  );

  const options: SeoWorkflowOptions = {
    context,
  };

  if (provider) {
    options.provider = provider;
  }

  if (overrides && typeof overrides === "object") {
    options.overrides =
      overrides as NonNullable<SeoWorkflowOptions["overrides"]>;
  }

  if (siteStructure) {
    options.siteStructure = siteStructure;
  }

  return options;
};

export const generateSeoContent = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const options = buildWorkflowOptions(req.body as UnknownRecord);
    const result = await runSeoWorkflow(options);
    res.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate content.";
    res.status(400).json({
      error: message,
    });
  }
};
