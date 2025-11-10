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

This step provides entity/topic cues for the agents and the blog input builder.

## 3. Facts Researcher Agent

Invoked by `runAgentCall` with system prompt `SEO_AGENT_PROMPTS.factsResearcher`.

- **Provider**: Gemini (overridable).
- **Input payload**:

```jsonc
{
  "context": { ...SeoAgentContext... },
  "textrazor": { ...TextRazorInsights... }
}
```

- **Expected JSON response** (`AgentFactsResult`):

```jsonc
{
  "facts": [
    {
      "fact": "single sentence metric",
      "publisher": "trusted source",
      "title": "Source title",
      "url": "https://...",
      "published_date": "YYYY-MM-DD or empty",
      "updated_date": "",
      "evidence_type": "guideline|meta_analysis|...",
      "conflict": false
    }
  ],
  "paa_questions": [
    { "question": "...", "serp_keyword": "...", "region": "US" }
  ],
  "warnings": ["optional strings"]
}
```

Responses are sanitized—empty values are filtered out before downstream use.

## 4. BlogWeaver Input Builder

`buildBlogWeaverInput` (`src/services/seo/blogInput.ts`) merges context + insights + facts into the JSON the Blog Weaver expects.

**Key fields** (`BlogWeaverInput`):

- `title`: From `context.blog_topic`.
- `audience` & `brand_voice`: Overrides or defaults.
- `primary_keyword`: Derived from the first `h1`.
- `secondary_keywords`: Top 12 unique entities/topics excluding the head term.
- `locale`, `ymyl`, `publish_mode`: Defaults (`en-US`, `false`, `draft`) unless overridden.
- `entities`: First 20 entities with normalized type (`org`, `topic`, `person`, `thing`).
- `facts` / `paa_questions`: Passed through from Facts Researcher (safe defaults are empty arrays).
- `internal_links`: Up to three slugs from `site_structure.available_slugs`.

## 5. Blog Weaver Agent

Invoked with `SEO_AGENT_PROMPTS.blogWeaver`, a semantic-density prompt that enforces:

- ENTITY→RELATIONSHIP→BRIDGE paragraph structure.
- WHY→HOW→WHAT progression.
- 4–7 sentence paragraphs with causal bridges.
- `<article>` HTML, snippet-ready answer, FAQs, references, and JSON-LD.

**Provider**: OpenAI by default (overrideable).  
**Input**: `BlogWeaverInput`.  
**Output**: HTML string trimmed of leading/trailing whitespace.

## 6. Response Assembly & Cost Logging

`runSeoWorkflow` (`src/services/seo/orchestrator.ts`) packages the final response:

```ts
{
  context: SeoAgentContext;
  siteStructure?: SiteStructure;
  outputs: {
    textrazor: TextRazorInsights;
    facts: AgentFactsResult;
    blogInput: BlogWeaverInput;
    draft: string; // HTML
  };
  timings: SeoWorkflowTiming[]; // per-step durations
  provider: AiProvider;         // base provider selection
  models: Record<string, string>; // agent -> "provider:modelId"
}
```

### Cost Logging

Each agent call records token counts and estimates USD spend. Logging is emitted once per workflow:

```jsonc
{
  "totalUsd": 0.042135,
  "breakdown": [
    {
      "agent": "factsResearcher",
      "provider": "gemini",
      "model": "gemini:gemini-2.5-pro",
      "inputTokens": 820,
      "outputTokens": 420,
      "costUsd": 0.008715
    },
    {
      "agent": "blogWeaver",
      "provider": "openai",
      "model": "openai:gpt-5-2025-08-07",
      "inputTokens": 1450,
      "outputTokens": 2500,
      "costUsd": 0.03342
    }
  ]
}
```

Default per-1k token prices are provided for common models. Override by setting `AI_TOKEN_PRICING` to a JSON string, for example:

```bash
export AI_TOKEN_PRICING='{
  "openai:gpt-5-2025-08-07": { "input": 0.012, "output": 0.036 },
  "gemini": { "input": 0.0004, "output": 0.0012 }
}'
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required for Blog Weaver (and any OpenAI agent). |
| `ANTHROPIC_API_KEY` | Optional; used if you switch providers. |
| `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` | Required for Facts Researcher default provider. |
| `TEXT_RAZOR_API_KEY` | Required for entity extraction. |
| `AI_TOKEN_PRICING` | Optional JSON overrides for cost estimation. |
| `PORT`, `NODE_ENV` | Standard server configuration. |

## Running Locally

```bash
npm install
cp .env.example .env # fill in API keys
npm run build
npm run start
```

Send POST requests to the configured endpoint with the request shape above. Inspect logs for step timings, agent usage, and cost estimates.

## Extending the Pipeline

- **Add a new agent**: Define a prompt in `src/prompts/seoAgents.ts`, update `agentDefaults`, extend the orchestration sequence, and include pricing data.
- **Change facts sourcing**: Modify `factsResearcher` prompt or adjust tool usage in `createGeminiTools`.
- **Customize HTML output**: Update `SEO_AGENT_PROMPTS.blogWeaver` and mirror the requirements in `updates.md`.

Refer to `docs/seo_agents_architecture.json` and `docs/seo_pipeline_reference.json` for additional background concepts.
