/**
 * JSON handling shared by every AI provider (2026-10-04). The site's prompts
 * describe their answer with a Gemini-style response schema (upper-case
 * types). Gemini enforces it itself; the other providers (Groq, OpenRouter,
 * Ollama, anything OpenAI-compatible) only promise "valid JSON", so the
 * router states the schema in the prompt and checks the answer against it
 * here, falling back to the next provider when it doesn't fit.
 */

export interface GeminiSchema {
  type: string;
  description?: string;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
  enum?: string[];
  nullable?: boolean;
}

// The same schema as standard JSON Schema (lower-case types), for the prompt
// (pure, unit-tested).
export function toJsonSchema(s: GeminiSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type.toLowerCase() };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  if (s.required) out.required = s.required;
  if (s.items) out.items = toJsonSchema(s.items);
  return out;
}

// null when `data` fits the schema, else what's wrong (pure, unit-tested).
// Lenient about extra properties and absent optional ones; strict about the
// shape of what the caller will read.
export function validateAgainstSchema(data: unknown, s: GeminiSchema, path = "$"): string | null {
  if (data === null || data === undefined) return s.nullable ? null : `${path} is missing`;
  switch (s.type.toUpperCase()) {
    case "OBJECT": {
      if (typeof data !== "object" || Array.isArray(data)) return `${path} is not an object`;
      const obj = data as Record<string, unknown>;
      for (const key of s.required ?? []) {
        if (obj[key] === undefined || (obj[key] === null && !s.properties?.[key]?.nullable)) return `${path}.${key} is missing`;
      }
      for (const [key, sub] of Object.entries(s.properties ?? {})) {
        if (obj[key] === undefined || obj[key] === null) continue;
        const err = validateAgainstSchema(obj[key], sub, `${path}.${key}`);
        if (err) return err;
      }
      return null;
    }
    case "ARRAY": {
      if (!Array.isArray(data)) return `${path} is not an array`;
      if (!s.items) return null;
      for (let i = 0; i < data.length; i++) {
        const err = validateAgainstSchema(data[i], s.items, `${path}[${i}]`);
        if (err) return err;
      }
      return null;
    }
    case "STRING":
      if (typeof data !== "string") return `${path} is not a string`;
      return s.enum && !s.enum.includes(data) ? `${path} is not one of ${s.enum.join("/")}` : null;
    case "BOOLEAN":
      return typeof data === "boolean" ? null : `${path} is not a boolean`;
    case "NUMBER":
    case "INTEGER":
      return typeof data === "number" && Number.isFinite(data) ? null : `${path} is not a number`;
    default:
      return null;
  }
}

// The JSON in a model's reply: plain, inside a code fence, after a
// reasoning block, or surrounded by chatter (pure, unit-tested). undefined
// when there is none.
export function extractJson(text: string): unknown | undefined {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const tryParse = (s: string): unknown | undefined => {
    try { return JSON.parse(s); } catch { return undefined; }
  };
  const direct = tryParse(cleaned);
  if (direct !== undefined) return direct;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return start >= 0 && end > start ? tryParse(cleaned.slice(start, end + 1)) : undefined;
}

// The instruction added to a prompt for providers that don't enforce a schema.
export function jsonInstruction(s: GeminiSchema): string {
  return `\n\nReply with ONLY one JSON object (no markdown, no commentary) that matches this JSON Schema exactly:\n${JSON.stringify(toJsonSchema(s))}`;
}
