import type { AiProvider } from "../aiClient";

export type HeadingTag = "h1" | "h2" | "h3";

export interface SeoContextRow {
  order: number;
  heading_tag: HeadingTag;
  content: string;
}

export interface SeoAgentContext {
  blog_url?: string;
  blog_topic: string;
  rows: SeoContextRow[];
}

export interface SiteStructure {
  available_slugs: string[];
  external_whitelist: string[];
}

export interface NormalizedEntity {
  name: string;
  type: string;
  relevance: number;
  confidence: number;
  sourceUrl?: string;
}

export interface TextRazorInsights {
  entities: NormalizedEntity[];
  ngrams: string[];
  topics: string[];
  raw?: unknown;
}

export interface ResearchFact {
  fact: string;
  publisher: string;
  title: string;
  url: string;
  published_date: string;
  updated_date: string;
  evidence_type: string;
  conflict: boolean;
}

export interface PeopleAlsoAskQuestion {
  question: string;
  serp_keyword: string;
  region: string;
}

export interface AgentFactsResult {
  facts: ResearchFact[];
  paa_questions: PeopleAlsoAskQuestion[];
  warnings?: string[];
}

export interface BlogOutlineItem {
  tag: HeadingTag;
  text: string;
}

export interface BlogCompetitorInsight {
  url: string;
  claims: string[];
  headings: string[];
  gaps_we_can_fill: string[];
}

export interface InternalLinkSuggestion {
  anchor: string;
  url: string;
}

export interface BlogWeaverInput {
  title: string;
  audience: string;
  brand_voice: string;
  primary_keyword: string;
  secondary_keywords: string[];
  locale: string;
  ymyl: boolean;
  publish_mode: "draft" | "publish";
  entities: Array<{ name: string; type: string }>;
  ngrams: string[];
  outline: BlogOutlineItem[];
  competitors: BlogCompetitorInsight[];
  facts: ResearchFact[];
  paa_questions: PeopleAlsoAskQuestion[];
  internal_links: InternalLinkSuggestion[];
}

export interface SeoWorkflowTiming {
  step: string;
  durationMs: number;
}

export interface SeoWorkflowOutputs {
  textrazor: TextRazorInsights;
  facts: AgentFactsResult;
  blogInput: BlogWeaverInput;
  draft: string;
}

export interface SeoWorkflowResult {
  context: SeoAgentContext;
  siteStructure?: SiteStructure;
  outputs: SeoWorkflowOutputs;
  timings: SeoWorkflowTiming[];
  provider: AiProvider;
  models: Record<string, string>;
}

export interface AiCallOverrides {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export interface SeoWorkflowOptions {
  context: SeoAgentContext;
  provider?: AiProvider;
  siteStructure?: SiteStructure;
  overrides?: Partial<Record<AgentIdentifier, AiCallOverrides>>;
  audienceOverride?: string;
  brandVoiceOverride?: string;
  localeOverride?: string;
  ymyl?: boolean;
  publishMode?: "draft" | "publish";
}

export type AgentIdentifier = "factsResearcher" | "blogWeaver";
