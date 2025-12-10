import type { CoreMessage, ToolChoice } from "ai";
import { z } from "zod";

export type AiProvider = "openai" | "anthropic" | "gemini";

export type AiReasoningEffort = "low" | "medium" | "high";

export interface AiToolDefinition {
  execute?: (...args: unknown[]) => unknown;
  input_schema: z.ZodType<unknown>;
  description?: string;
}

export type AiToolSet = Record<string, AiToolDefinition>;

export interface AiCallOverrides {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: AiReasoningEffort;
}

export interface AiCallConfig<OutputShape = unknown> {
  provider: AiProvider;
  model_name?: string;
  system_prompt?: string;
  prompt?: string;
  messages?: CoreMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: AiToolSet;
  tool_choice?: ToolChoice<AiToolSet>;
  reasoning_effort?: AiReasoningEffort;
  output_schema?: z.ZodType<OutputShape>;
}

export interface AiCallResult<OutputShape = unknown> {
  text: string;
  finish_reason: string;
  usage: Record<string, unknown>;
  parsed_output?: OutputShape;
  raw_response: unknown;
}
