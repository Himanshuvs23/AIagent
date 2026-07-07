export  function supportsJsonResponse(model) {
  return model.startsWith("gpt-") || model.startsWith("openai/");
}

export function extractJsonCandidates(raw) {
  const candidates = [];

  const codeFenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of raw.matchAll(codeFenceRegex)) {
    if (match[1]) {
      candidates.push(match[1].trim());
    }
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

export function parseJsonFromText(raw) {
  if (typeof raw !== "string") {
    throw new Error("Planner returned non-text content");
  }
  const attempts = [raw, ...extractJsonCandidates(raw)];
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue trying other candidates.
    }
  }
  throw new Error("Planner returned invalid JSON");
}
