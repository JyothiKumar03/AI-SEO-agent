# AI_SEO Workflow Overview

This project orchestrates a multi-agent pipeline that turns a structured blog outline into publication-ready HTML. The workflow stitches together entity intelligence, factual research, and a semantic-density copywriting agent. This README explains the inputs, intermediate payloads, and outputs so you can reason about—or extend—the system easily.

## High-Level Flow

1. **HTTP Request** → `src/controllers/seoController.ts`
2. **TextRazor entity analysis** → `src/services/seo/textrazor.ts`
3. **Facts Researcher agent (Gemini)** → `src/prompts/seoAgents.ts` + `runAgentCall`
4. **Blog Weave input builder** → `src/services/seo/blogInput.ts`
5. **Blog Weaver agent (OpenAI)** → `src/prompts/seoAgents.ts`
6. **Result assembly & cost logging** → `src/services/seo/orchestrator.ts`

Every stage emits structured data that the next step consumes. The final response combines all intermediate artifacts, timing metadata, models used, and an estimated LLM cost breakdown.

## 1. Request Handling

Endpoint handled by `generateSeoContent` in `src/controllers/seoController.ts`.

### Expected Request Shape

```jsonc
{
  "context": {
    "blog_topic": "string (required)",
    "rows": [
      { "order": 1, "heading_tag": "h1", "content": "..." },
      { "order": 2, "heading_tag": "h2", "content": "..." }
    ],
    "blog_url": "optional string"
  },
  "provider": "openai | anthropic | gemini (optional base provider)",
  "site_structure": {
    "available_slugs": ["optional", "..."],
    "external_whitelist": ["optional", "..."]
  },
  "overrides": {
    "factsResearcher": { "model": "...", "temperature": 0.2, ... },
    "blogWeaver": { "maxTokens": 8000, ... }
  },
  "audienceOverride": "optional string",
  "brandVoiceOverride": "optional string",
  "localeOverride": "optional locale code",
  "ymyl": true,
  "publishMode": "draft | publish"
}
```

### Controller Responsibilities

- Validates and normalizes headings (`h1`/`h2`/`h3` only).
- Sorts rows by `order`.
- Makes `blog_url` optional (trimmed if provided).
- Passes a `SeoWorkflowOptions` object into the orchestrator.

## 2. TextRazor Entity Extraction

`analyzeContextWithTextRazor` (`src/services/seo/textrazor.ts`) issues a POST to TextRazor using `TEXT_RAZOR_API_KEY`.

**Input**: `SeoAgentContext` from the controller.  
**Output** (`TextRazorInsights`):

```ts
{
  entities: NormalizedEntity[];
  ngrams: string[];
  topics: string[];
  raw?: unknown; // included in non-production runs
}
```
