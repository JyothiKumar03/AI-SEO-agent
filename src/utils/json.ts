export class JsonParseError extends Error {
  constructor(message: string, readonly original?: unknown) {
    super(message);
    this.name = "JsonParseError";
  }
}

const extractJsonString = (raw: string): string => {
  const trimmed = raw.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenceMatch && typeof fenceMatch[1] === "string") {
    return fenceMatch[1].trim();
  }

  return trimmed;
};

export const parseJson = <T>(raw: string): T => {
  console.log(`JSON OUTPUT - ${raw}`)
  const jsonString = extractJsonString(raw);

  try {
    // Remove ```json and ``` from the string, just in case extractJsonString didn't already
    const cleanedJsonString = jsonString
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    return JSON.parse(cleanedJsonString) as T;
  } catch (error) {
    throw new JsonParseError("Failed to parse JSON output from model.", {
      raw,
      jsonString,
      error,
    });
  }
};
