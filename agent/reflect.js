import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || "https://openrouter.ai/api/v1";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL,
  defaultHeaders: baseURL?.includes("openrouter.ai")
    ? {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "AI Agent"
      }
    : undefined 
});

const REFLECT_MODEL =
  process.env.REFLECT_MODEL || (baseURL?.includes("openrouter.ai") ? "meta-llama/llama-3.3-70b-instruct" : "gpt-4o-mini");

function supportsJsonResponse(model) {
  return model.startsWith("gpt-") || model.startsWith("openai/");
}

function parseJsonFromText(raw) {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function reflect(query, result) {

  const prompt = `
User request: ${query}

Agent result: ${result}

Evaluate if the result successfully solves the request.

Return JSON:
{
 "success": true/false,
 "reason": "explanation"
}
`;

  const request = {
    model: REFLECT_MODEL,
    messages: [
      { role: "system", content: "You evaluate AI outputs." },
      { role: "user", content: prompt }
    ],
    temperature: 0
  };
  const useJsonMode = supportsJsonResponse(REFLECT_MODEL);
  if (useJsonMode) {
    request.response_format = { type: "json_object" };
  }

  let response;
  try {
    console.log("Reflection request:", request);
    response = await openai.chat.completions.create(request);
  } catch (err) {
    if (useJsonMode && err?.status === 400) {
      const fallbackRequest = { ...request };
      delete fallbackRequest.response_format;
      response = await openai.chat.completions.create(fallbackRequest);
    } else {
      throw err;
    }
  }
  const raw = response.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonFromText(raw);
  if (!parsed) {
    return {
      success: false,
      reason: "Reflection returned invalid JSON"
    };
  }
  return parsed;
}
