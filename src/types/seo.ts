import { z } from "zod";
import type { AiCallOverrides, AiProvider } from "./ai";

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

export const research_fact_schema = z.object({
  fact: z.string().default(""),
  publisher: z.string().default(""),
  title: z.string().default(""),
  url: z.string().default(""),
  published_date: z.string().default(""),
  updated_date: z.string().default(""),
  evidence_type: z.string().default(""),
  conflict: z.boolean().default(false),
});

export type ResearchFact = z.infer<typeof research_fact_schema>;

export const people_also_ask_question_schema = z.object({
  question: z.string().default(""),
  serp_keyword: z.string().default(""),
  region: z.string().default(""),
});

export type PeopleAlsoAskQuestion = z.infer<
  typeof people_also_ask_question_schema
>;

export const agent_facts_result_schema = z.object({
  facts: research_fact_schema.array().default([]),
  paa_questions: people_also_ask_question_schema.array().default([]),
  warnings: z.array(z.string()).default([]),
});

export type AgentFactsResult = z.infer<typeof agent_facts_result_schema>;

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

export type AgentIdentifier = "factsResearcher" | "blogWeaver";

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
