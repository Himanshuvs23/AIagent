import OpenAI from "openai";
import { parseJsonFromText, supportsJsonResponse } from "./libs/output.js";
import { hasApproxKeyword } from "./libs/inputchecker.js";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "AI Agent"
  }
});

const planSchema = z.object({
  type: z.enum(["tool", "text"]),
  reasoning: z.string().optional(),
  response: z.string().nullable().optional(),
  steps: z.array(
    z.object({
      tool: z.string(),
      args: z.record(z.any())
    })
  ).nullable().optional()
}).strict();

const rawModelList = process.env.PLANNER_MODELS
  ? process.env.PLANNER_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
  : [ 
    "openai/gpt-4o-mini",
    "deepseek/deepseek-chat",
      "meta-llama/llama-3.3-70b-instruct",
      process.env.PLANNER_MODEL,
      process.env.PLANNER_RETRY_MODEL
    ].filter(Boolean);

export const MODEL_CANDIDATES = [...new Set(rawModelList)];
const PLANNER_MAX_TOKENS = Number(process.env.PLANNER_MAX_TOKENS || 660);

const DEFAULT_SYSTEM_PROMPT = `You are an autonomous AI planning system that converts a user request into an executable plan.

You control tools that can interact with the operating system, APIs, and the internet.

Your job is ONLY to produce a valid JSON plan that the agent can execute.

Return EXACTLY ONE JSON object.`;

function normalizePlanStep(step) {
  if (!step || typeof step !== "object") {
    return step;
  }

  if (typeof step.tool === "string" && step.args && typeof step.args === "object") {
    return step;
  }

  const inferredTool =
    typeof step.tool === "string"
      ? step.tool
      : typeof step.name === "string" || Array.isArray(step.capabilities)
        ? "subAgent"
        : null;

  if (!inferredTool) {
    return step;
  }

  const { tool, args, ...rest } = step;
  return {
    tool: inferredTool,
    args:
      args && typeof args === "object"
        ? args
        : {
            ...rest
          }
  };
}

function normalizePlanShape(plan) {
  if (!plan || typeof plan !== "object") {
    return plan;
  }

  const normalizedType =
    plan.type === "subAgent"
      ? "tool"
      : plan.type;

  const normalizedSteps = Array.isArray(plan.steps)
    ? plan.steps.map((step) => normalizePlanStep(step))
    : plan.steps;

  return {
    ...plan,
    type: normalizedType,
    steps: normalizedSteps
  };
}

export function inferFallbackPlan(userQuery) {
  const queryText =
    typeof userQuery === "string"
      ? userQuery
      : JSON.stringify(userQuery ?? "");
  const lower = queryText.toLowerCase();
  const emailMatch = queryText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const absPaths = queryText.match(/\/[^\s'"]+/g) || [];
  const filePath = absPaths.find((p) => /\.[A-Za-z0-9]+$/.test(p));
  const wantsEmail =
    hasApproxKeyword(lower, ["send", "mail", "email", "attach", "attachment"]) ||
    /@/.test(lower);
  if (wantsEmail && emailMatch) {
    return {
      type: "tool",
      reasoning: "Planner fallback inferred email task due model/credit failure.",
      response: null,
      steps: [
        {
          tool: "sentEmail",
          args: {
            recipient: emailMatch[0],
            subject: "Requested file",
            message_body: "Please find the requested file attached.",
            ...(filePath ? { attachment: filePath } : {})
          }
        }
      ]
    };
  }

  const mathExpressionMatch = queryText.match(/(-?\d+(?:\s*[\+\-\*\/%]\s*-?\d+)+(?:\s*[\+\-\*\/%]\s*-?\d+)*)/);
  if (mathExpressionMatch?.[1]) {
    return {
      type: "tool",
      reasoning: "Planner fallback inferred a math task due model/credit failure.",
      response: null,
      steps: [
        {
          tool: "mathTool",
          args: {
            expression: mathExpressionMatch[1]
          }
        }
      ]
    };
  }

  const wantsSearch = hasApproxKeyword(lower, ["search", "latest", "breaking", "news", "find", "look" , "information "]);
  const wantsOpenApp =
    hasApproxKeyword(lower, ["open", "launch", "start"]) &&
    !hasApproxKeyword(lower, ["file", "txt", "document"]) &&
    (hasApproxKeyword(lower, ["app", "application", "calculator", "chrome", "safari", "notes", "terminal", "finder", "vscode", "code"]) ||
      /\b(open|launch|start)\s+(?:the\s+)?[A-Za-z][A-Za-z0-9 ._-]*$/i.test(queryText));
  const wantsPlayableMedia =
    hasApproxKeyword(lower, ["play", "song", "songs", "music"]) ||
    lower.includes("youtube");
  const wantsAnalysis =
    hasApproxKeyword(lower, ["analysis", "analyze", "data", "trend", "trading"]) ||
    /\blast\s+\d+\s+trading\s+days\b/i.test(queryText);
  const wantsFile =
    hasApproxKeyword(lower, ["create", "write", "save", "make" ,"read"]) &&
    hasApproxKeyword(lower, ["file", "txt", "document"]);

  if (wantsOpenApp) {
    const appNameMatch = queryText.match(/\b(?:open|launch|start)\s+(?:the\s+)?(?:app(?:lication)?\s+)?([A-Za-z][A-Za-z0-9 ._-]*?)(?:\s+app(?:lication)?)?[\s.?!]*$/i);
    const appName = normalizeAppName(appNameMatch?.[1] || queryText);

    return {
      type: "tool",
      reasoning: "Planner fallback inferred an app-opening task due model/credit failure.",
      response: null,
      steps: [
        {
          tool: "openApplication",
          args: {
            appName
          }
        }
      ]
    };
  }

  if (wantsSearch && !wantsFile) {
    return {
      type: "tool",
      reasoning: "Planner fallback inferred a direct search task due model/credit failure.",
      response: null,
      steps: [
        {
          tool: "searchWeb",
          args: {
            query: queryText
          }
        }
      ]
    };
  }

  if (wantsAnalysis) {
    const analysisQuery = /\bnifty\b/i.test(queryText)
      ? "Nifty 50 last 30 trading days price movement trend support resistance volume market summary"
      : `${queryText} latest data summary analysis`;

    return {
      type: "tool",
      reasoning: "Planner fallback inferred a market/data analysis search task due model/credit failure.",
      response: null,
      steps: [
        {
          tool: "searchWeb",
          args: {
            query: analysisQuery
          }
        }
      ]
    };
  }

  if (wantsPlayableMedia) {
    return {
      type: "tool",
      reasoning: "Planner fallback inferred a media lookup task due model/credit failure.",
      response: null,
      steps: [
        {
          tool: "subAgent",
          args: {
            instructions: queryText,
            capabilities: ["searchWeb"]
          }
        }
      ]
    };
  }

  if (wantsFile && !wantsSearch) {
    const fileNameMatch = queryText.match(/\b([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)\b/);
    const filePathForCreate = fileNameMatch?.[1] || "generated/generated.txt";
    const contentMatch =
      queryText.match(/\b(?:with|containing|content|text)\s+["']([^"']+)["']/i) ||
      queryText.match(/\b(?:with|containing|content|text)\s+(.+)$/i);
    const fileContent = contentMatch?.[1]?.trim() || "";

    return {
      type: "tool",
      reasoning: "Planner fallback inferred a file creation task due model/credit failure.",
      response: null,
      steps: [
        {
          tool: "createFile",
          args: {
            path: filePathForCreate,
            content: fileContent
          }
        }
      ]
    };
  }

  if (!wantsSearch || !wantsFile) {
    return {
      type: "text",
      reasoning: "Planner fallback used due model/credit failure.",
      response: "I couldn't create a reliable tool plan automatically. Please rephrase the task in one line with required tool action.",
      steps: null
    };
  }

  const fileNameMatch = queryText.match(/\b([A-Za-z0-9._-]+\.txt)\b/);
  const fileName = fileNameMatch?.[1] || "news.txt";

  const absolutePaths = queryText.match(/\/[A-Za-z0-9._/-]+/g) || [];
  const folderPath = absolutePaths.length ? absolutePaths[absolutePaths.length - 1] : ".";
  const finalPath = folderPath.endsWith(`/${fileName}`) ? folderPath : `${folderPath.replace(/\/$/, "")}/${fileName}`;

  const topicMatch = queryText.match(/news on ([^.,\n]+)/i);
  const topic = topicMatch?.[1]?.trim() || "Iran";
  const searchQuery = `latest breaking news on ${topic}`;

  return {
    type: "tool",
    reasoning: "Planner fallback inferred search+createFile flow due model/credit failure.",
    response: null,
    steps: [
      {
        tool: "searchWeb",
        args: { query: searchQuery }
      },
      {
        tool: "createFile",
        args: { path: finalPath, content: "{previous_result}" }
      }
    ]
  };
}

function normalizeAppName(value) {
  const cleaned = String(value || "")
    .replace(/\b(open|launch|start|app|application|please|the)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliases = new Map([
    ["chrome", "Google Chrome"],
    ["google chrome", "Google Chrome"],
    ["vs code", "Visual Studio Code"],
    ["vscode", "Visual Studio Code"]
  ]);

  return aliases.get(cleaned.toLowerCase()) || cleaned || "Finder";
}

export async function generatePlan({ model, userQuery, messages = [], extraSystem, systemPrompt }) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const lastMessage = safeMessages[safeMessages.length - 1];
  const shouldAppendUserMessage =
    !lastMessage ||
    lastMessage.role !== "user" ||
    typeof lastMessage.content !== "string" ||
    lastMessage.content.trim() !== String(userQuery ?? "").trim();

  const finalMessages = [
    { role: "system", content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
    ...safeMessages,
    ...(shouldAppendUserMessage ? [{ role: "user", content: userQuery }] : []),
    ...(extraSystem ? [{ role: "system", content: extraSystem }] : [])
  ];

  const request = {
    model,
    messages : finalMessages,
    temperature: 0,
    max_tokens: PLANNER_MAX_TOKENS
  };
  const useJsonMode = supportsJsonResponse(model);
  if (useJsonMode) {
    request.response_format = { type: "json_object" };
  }

  console.log("Trying planner model:", model);

  let result;
  try {
    result = await openai.chat.completions.create(request);
  } catch (err) {
    if (useJsonMode && err?.status === 400) {
      const fallbackRequest = { ...request };
      delete fallbackRequest.response_format;
      result = await openai.chat.completions.create(fallbackRequest);
    } else {
      throw err;
    }
  }
  const raw = result.choices?.[0]?.message?.content ?? "";
  console.log("RAW PLAN:", raw);

  const parsed = parseJsonFromText(raw);
  const normalizedPlan = normalizePlanShape(parsed);
  const validated = planSchema.safeParse(normalizedPlan);
  if (!validated.success) {
    console.log(
      "Schema validation failed:",
      JSON.stringify(validated.error.issues, null, 2)
    );
    throw new Error("Invalid plan schema");
  }
  console.log("Validated plan:", validated.data);
  return validated.data;
}

export async function generatePlanWithFallback({ models, userQuery, messages, extraSystem, systemPrompt }) {
  let lastError;
  for (const model of models) {
    try {
      return await generatePlan({
        model,
        userQuery,
        messages,
        extraSystem,
        systemPrompt
      });
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      const canTryNext =
        error?.status === 404 ||
        error?.status === 400 ||
        error?.status === 429 ||
        message.includes("No endpoints found");
      if (canTryNext) {
        console.log(`Planner model failed (${model}):`, message);
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("No planner models succeeded");
}
