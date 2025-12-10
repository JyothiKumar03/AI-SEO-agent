export class JsonParseError extends Error {
  constructor(message: string, readonly original?: unknown) {
    super(message);
    this.name = "JsonParseError";
  }
}

const extract_json_string = (raw: string): string => {
  const trimmed = raw.trim();

  const fence_match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fence_match && typeof fence_match[1] === "string") {
    return fence_match[1].trim();
  }

  return trimmed;
};

export const parse_json = <T>(raw: string): T => {
  console.log(`JSON OUTPUT - ${raw}`);
  const json_string = extract_json_string(raw);

  try {
    const cleaned_json_string = json_string
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    return JSON.parse(cleaned_json_string) as T;
  } catch (error) {
    throw new JsonParseError("Failed to parse JSON output from model.", {
      raw,
      jsonString: json_string,
      error,
    });
  }
};

export const parseJson = parse_json;
