import mongoose from "mongoose";
import OpenAI from "openai";

const { Schema, model } = mongoose;

const DEFAULT_SCOPE = "default-user";
const PROFILE_LIMIT = 10;
const SESSION_SUMMARY_LIMIT = 1200;

const memoryFactSchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: String, required: true },
    confidence: { type: Number, default: 0.6 },
    source: { type: String, default: "memory-update" }
  },
  { _id: false }
);

const memoryProfileSchema = new Schema(
  {
    scope: { type: String, required: true, unique: true },
    summary: { type: String, default: "" },
    facts: { type: [memoryFactSchema], default: [] }
  },
  { timestamps: true }
);

const sessionMemorySchema = new Schema(
  {
    chatId: {
      type: Schema.Types.ObjectId,
      ref: "conversation",
      required: true,
      unique: true
    },
    summary: { type: String, default: "" }
  },
  { timestamps: true }
);

const MemoryProfile =
  mongoose.models.memory_profile || model("memory_profile", memoryProfileSchema);
const SessionMemory =
  mongoose.models.session_memory || model("session_memory", sessionMemorySchema);

const memoryBaseURL =
  process.env.OPENAI_BASE_URL ||
  process.env.OPENAI_API_BASE ||
  "https://openrouter.ai/api/v1";

const memoryModel =
  process.env.MEMORY_MODEL ||
  process.env.SUBAGENT_MODEL ||
  process.env.PLANNER_MODEL ||
  "openai/gpt-4o-mini";

const memoryClient = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: memoryBaseURL,
      defaultHeaders: memoryBaseURL.includes("openrouter.ai")
        ? {
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "AI Agent Memory"
          }
        : undefined
    })
  : null;

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function truncateText(value = "", maxLength = 400) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function clampSummary(summary = "", maxLength = SESSION_SUMMARY_LIMIT) {
  return truncateText(summary, maxLength);
}

function formatFactsForPrompt(facts = []) {
  if (!Array.isArray(facts) || !facts.length) {
    return "None recorded.";
  }

  return facts
    .slice(0, PROFILE_LIMIT)
    .map((fact) => `- ${fact.key}: ${fact.value}`)
    .join("\n");
}

function mergeFacts(existingFacts = [], nextFacts = []) {
  const merged = new Map();

  for (const fact of existingFacts) {
    if (!fact?.key || !fact?.value) continue;
    merged.set(cleanText(fact.key).toLowerCase(), {
      key: cleanText(fact.key),
      value: cleanText(fact.value),
      confidence: typeof fact.confidence === "number" ? fact.confidence : 0.6,
      source: fact.source || "memory-update"
    });
  }

  for (const fact of nextFacts) {
    if (!fact?.key || !fact?.value) continue;
    merged.set(cleanText(fact.key).toLowerCase(), {
      key: cleanText(fact.key),
      value: cleanText(fact.value),
      confidence: typeof fact.confidence === "number" ? fact.confidence : 0.8,
      source: fact.source || "memory-update"
    });
  }

  return Array.from(merged.values()).slice(0, PROFILE_LIMIT);
}

function extractHeuristicFacts(text = "") {
  const normalized = cleanText(text);
  if (!normalized) return [];

  const facts = [];
  const namePatterns = [
    /\bmy name is ([A-Za-z][A-Za-z\s'-]{0,40})/i,
    /\bi am ([A-Za-z][A-Za-z\s'-]{0,40})/i,
    /\bcall me ([A-Za-z][A-Za-z\s'-]{0,40})/i
  ];

  for (const pattern of namePatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      facts.push({
        key: "name",
        value: match[1].trim(),
        confidence: 0.85,
        source: "heuristic"
      });
      break;
    }
  }

  const preferencePatterns = [
    { key: "preferred_language", regex: /\bi prefer ([A-Za-z0-9.+#\s-]{2,40})/i },
    { key: "preferred_stack", regex: /\buse ([A-Za-z0-9.+#\s-]{2,40})/i },
    { key: "location", regex: /\bi am from ([A-Za-z\s-]{2,40})/i }
  ];

  for (const item of preferencePatterns) {
    const match = normalized.match(item.regex);
    if (match?.[1]) {
      facts.push({
        key: item.key,
        value: match[1].trim(),
        confidence: 0.7,
        source: "heuristic"
      });
    }
  }

  return facts;
}

function buildHeuristicSessionSummary(previousSummary = "", latestUserMessage = "", latestAssistantMessage = "") {
  const pieces = [cleanText(previousSummary)].filter(Boolean);
  const userLine = latestUserMessage ? `User asked: ${truncateText(latestUserMessage, 220)}` : "";
  const assistantLine = latestAssistantMessage
    ? `Assistant answered: ${truncateText(latestAssistantMessage, 220)}`
    : "";

  if (userLine) pieces.push(userLine);
  if (assistantLine) pieces.push(assistantLine);

  return clampSummary(pieces.join(" "));
}

async function generateMemoryUpdateWithLLM({
  profileSummary,
  facts,
  sessionSummary,
  recentMessages,
  latestUserMessage,
  latestAssistantMessage
}) {
  if (!memoryClient) {
    return null;
  }

  const transcript = recentMessages
    .slice(-8)
    .map((message) => `${message.role}: ${cleanText(message.content)}`)
    .join("\n");

  const prompt = [
    "Update the assistant memory using the conversation below.",
    "Return compact JSON with this exact shape:",
    '{"profile_summary":"string","session_summary":"string","facts":[{"key":"string","value":"string","confidence":0.0}]}',
    "Only keep stable user facts in facts. Examples: name, preferences, location, role, goals.",
    "Do not store temporary requests as profile facts.",
    "Keep session_summary focused on the current ongoing task.",
    "",
    `Existing profile summary: ${profileSummary || "None"}`,
    `Existing profile facts:\n${formatFactsForPrompt(facts)}`,
    `Existing session summary: ${sessionSummary || "None"}`,
    "",
    `Latest user message: ${latestUserMessage || "None"}`,
    `Latest assistant message: ${latestAssistantMessage || "None"}`,
    "",
    "Recent transcript:",
    transcript || "None"
  ].join("\n");

  try {
    const response = await memoryClient.chat.completions.create({
      model: memoryModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You maintain compact long-term memory for a personal assistant."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const raw = response.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.log("Memory update fallback:", error?.message || error);
    return null;
  }
}

export async function getMemoryContext({ chatId, scope = DEFAULT_SCOPE }) {
  const [profile, session] = await Promise.all([
    MemoryProfile.findOne({ scope }).lean(),
    chatId ? SessionMemory.findOne({ chatId }).lean() : null
  ]);

  const messages = [];

  if (profile?.summary || profile?.facts?.length) {
    messages.push({
      role: "system",
      content: [
        "Persistent user memory:",
        profile.summary ? `Summary: ${profile.summary}` : "",
        profile.facts?.length ? `Facts:\n${formatFactsForPrompt(profile.facts)}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    });
  }

  if (session?.summary) {
    messages.push({
      role: "system",
      content: `Current conversation summary:\n${session.summary}`
    });
  }

  return messages;
}

export async function updateMemoryFromTurn({
  chatId,
  messages = [],
  latestUserMessage = "",
  latestAssistantMessage = "",
  scope = DEFAULT_SCOPE
}) {
  const [profileDoc, sessionDoc] = await Promise.all([
    MemoryProfile.findOne({ scope }),
    chatId ? SessionMemory.findOne({ chatId }) : null
  ]);

  const existingProfileSummary = profileDoc?.summary || "";
  const existingFacts = profileDoc?.facts || [];
  const existingSessionSummary = sessionDoc?.summary || "";

  const heuristicFacts = extractHeuristicFacts(latestUserMessage);
  const llmUpdate = await generateMemoryUpdateWithLLM({
    profileSummary: existingProfileSummary,
    facts: existingFacts,
    sessionSummary: existingSessionSummary,
    recentMessages: messages,
    latestUserMessage,
    latestAssistantMessage
  });

  const mergedFacts = mergeFacts(existingFacts, [
    ...heuristicFacts,
    ...((Array.isArray(llmUpdate?.facts) ? llmUpdate.facts : []).map((fact) => ({
      key: fact.key,
      value: fact.value,
      confidence: fact.confidence,
      source: "llm"
    })))
  ]);

  const nextProfileSummary = clampSummary(
    llmUpdate?.profile_summary || existingProfileSummary
  );
  const nextSessionSummary = clampSummary(
    llmUpdate?.session_summary ||
      buildHeuristicSessionSummary(
        existingSessionSummary,
        latestUserMessage,
        latestAssistantMessage
      )
  );

  await MemoryProfile.findOneAndUpdate(
    { scope },
    {
      scope,
      summary: nextProfileSummary,
      facts: mergedFacts
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (chatId) {
    await SessionMemory.findOneAndUpdate(
      { chatId },
      {
        chatId,
        summary: nextSessionSummary
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  return {
    profileSummary: nextProfileSummary,
    sessionSummary: nextSessionSummary,
    facts: mergedFacts
  };
}
