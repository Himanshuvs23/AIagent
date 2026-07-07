import fetch from "node-fetch";
import nodemailer from "nodemailer";
import OpenAI from "openai";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import dotenv from "dotenv";
import axios from "axios";
import {
  buildSearchQuery,
  DEFAULT_UA,
  domainFromUrl,
  enrichResultsWithSummaries,
  formatSearchResults,
  isNewsIntent,
  isQuestionIntent,
  searchBingByBrowser,
  searchBingByFetch,
  rerankResultsForIntent,
  searchDuckDuckGoByBrowser,
  searchDuckDuckGoByFetch,
  searchGoogleNewsRss,
  toPlainText
} from "./libs/searchfunctionality.js";

dotenv.config();

const openAIBaseURL =
  process.env.OPENAI_BASE_URL ||
  process.env.OPENAI_API_BASE ||
  "https://openrouter.ai/api/v1";

const subAgentModel =
  process.env.SUBAGENT_MODEL ||
  process.env.PLANNER_MODEL ||
  "openai/gpt-4o-mini";

const subAgentClient = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: openAIBaseURL,
      defaultHeaders: openAIBaseURL.includes("openrouter.ai")
        ? {
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "AI Agent"
          }
        : undefined
    })
  : null;

function isSubAgentLlmAvailable() {
  return Boolean(subAgentClient);
}

function cleanText(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

export async function sendTelegramMessage({ message }) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!message || !String(message).trim()) {
      return { success: false, error: "message is required" };
    }
    if (!token || !chatId) {
      return { success: false, error: "Telegram credentials are not configured" };
    }

    const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown"
    });

    return {
      success: true,
      messageId: response.data.result.message_id
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

export async function executeCommand(commandOrArgs = "") {
  try {
    const command =
      typeof commandOrArgs === "string" ? commandOrArgs : commandOrArgs?.command;

    if (!command) {
      return { success: false, error: "Command is required" };
    }

    if (/[|&;><`$]/.test(command)) {
      return {
        success: false,
        error: "Command contains blocked shell operators"
      };
    }

    const commandParts = parseCommandLine(command);
    const baseCommand = commandParts[0];
    const commandArgs = commandParts.slice(1);
    const allowedCommands = new Set([
      "pwd",
      "ls",
      "cat",
      "echo",
      "date",
      "whoami",
      "uname",
      "node",
      "npm",
      "open"
    ]);

    if (!allowedCommands.has(baseCommand)) {
      return {
        success: false,
        error: `Command "${baseCommand}" is not allowed`
      };
    }

    if (baseCommand === "open") {
      const validation = validateOpenCommandArgs(commandArgs);
      if (!validation.success) return validation;
    }

    const output = execFileSync(baseCommand, commandArgs, { stdio: "pipe" }).toString();
    return {
      success: true,
      output
    };
  } catch (error) {
    return {
      success: false,
      error: error.stderr?.toString() || error.message
    };
  }
}

function parseCommandLine(command) {
  const parts = [];
  let current = "";
  let quote = null;

  for (const char of String(command).trim()) {
    if ((char === "\"" || char === "'") && !quote) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) parts.push(current);
  return parts;
}

function validateOpenCommandArgs(args = []) {
  if (!args.length) {
    return { success: false, error: "open command requires an app name or target" };
  }

  const allowedFlags = new Set(["-a", "-b", "-R", "-g"]);
  const hasBlockedArg = args.some((arg) => /[;&|><`$]/.test(arg));
  if (hasBlockedArg) {
    return { success: false, error: "open command contains blocked shell operators" };
  }

  const flagArgs = args.filter((arg) => arg.startsWith("-"));
  const unsupportedFlag = flagArgs.find((arg) => !allowedFlags.has(arg));
  if (unsupportedFlag) {
    return { success: false, error: `open flag "${unsupportedFlag}" is not allowed` };
  }

  return { success: true };
}

export async function sentEmail(args = {}) {
  const recipient = args.recipient || args.to;
  const subject = args.subject || "No subject";
  const messageBody = args.message_body || args.body || "Please find the attached file.";
  const normalizedAttachments = []
    .concat(args.attachment || [])
    .concat(args.attachments || [])
    .filter(Boolean);

  if (!recipient) {
    return { success: false, error: "recipient email is required" };
  }
  if (!process.env.EMAIL || !process.env.EMAIL_PASS) {
    return { success: false, error: "Email credentials are not configured" };
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_PASS
    }
  });

  const mailOptions = {
    from: process.env.EMAIL,
    to: recipient,
    subject,
    text: messageBody
  };

  if (normalizedAttachments.length) {
    for (const filePath of normalizedAttachments) {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `attachment not found: ${filePath}` };
      }
    }

    mailOptions.attachments = normalizedAttachments.map((filePath) => ({
      path: filePath
    }));
  }

  const info = await transporter.sendMail(mailOptions);

  return {
    success: true,
    action: "sentEmail",
    to: recipient,
    attachment: normalizedAttachments[0] || null,
    attachments: normalizedAttachments,
    messageId: info.messageId
  };
}

export async function mathTool(expressionOrArgs) {
  try {
    const expression =
      typeof expressionOrArgs === "string"
        ? expressionOrArgs
        : expressionOrArgs?.expression;

    if (!expression) return "Invalid math expression";

    const normalizedExpression = String(expression).replace(/\s+/g, "");
    if (!/^[0-9+\-*/().% ]+$/.test(normalizedExpression)) {
      return "Invalid math expression";
    }

    const result = Function(`"use strict"; return (${normalizedExpression});`)();
    if (!Number.isFinite(result)) {
      return "Invalid math expression";
    }

    return `Math result: ${result}`;
  } catch {
    return "Invalid math expression";
  }
}

function buildSubAgentRequest(subAgentNameOrArgs, args) {
  if (typeof subAgentNameOrArgs === "string") {
    if (args && typeof args === "object") {
      return { ...args, name: subAgentNameOrArgs };
    }

    return {
      name: subAgentNameOrArgs,
      instructions: typeof args === "string" ? args : ""
    };
  }

  const payload =
    subAgentNameOrArgs && typeof subAgentNameOrArgs === "object"
      ? subAgentNameOrArgs
      : {};
  const nestedArgs =
    payload.args && typeof payload.args === "object" ? payload.args : {};

  return {
    ...payload,
    ...nestedArgs,
    name:
      payload.name ??
      payload.subAgentName ??
      payload.sub_agent ??
      nestedArgs.name ??
      nestedArgs.subAgentName,
    instructions:
      payload.instructions ??
      payload.prompt ??
      payload.task ??
      nestedArgs.instructions ??
      nestedArgs.prompt ??
      nestedArgs.task ??
      "",
    capabilities:
      payload.capabilities ??
      nestedArgs.capabilities ??
      [],
    command:
      payload.command ??
      nestedArgs.command,
    apiEndpoint:
      payload.apiEndpoint ??
      payload.endpoint ??
      nestedArgs.apiEndpoint ??
      nestedArgs.endpoint,
    outputs:
      payload.outputs ??
      payload.previousOutputs ??
      nestedArgs.outputs ??
      nestedArgs.previousOutputs,
    apiParams:
      payload.apiParams ??
      payload.params ??
      nestedArgs.apiParams ??
      nestedArgs.params
  };
}

function inferSubAgentName({ name, instructions, capabilities }) {
  if (name) return cleanText(name);

  const capabilityList = Array.isArray(capabilities)
    ? capabilities.filter(Boolean).map((item) => cleanText(item))
    : [];

  if (capabilityList.length) {
    return `${capabilityList.join("+")} agent`;
  }

  const text = cleanText(instructions).toLowerCase();
  if (text.includes("youtube")) return "youtube agent";
  if (text.includes("email")) return "email agent";
  if (text.includes("search")) return "search agent";
  if (text.includes("command")) return "command agent";
  if (text.includes("math")) return "math agent";
  if (text.includes("file")) return "file agent";

  return "generic agent";
}

function deriveSearchQueryFromInstructions(instructions = "") {
  const text = cleanText(instructions);
  if (!text) return "";

  const youtubeMatch = text.match(/play\s+(.+?)\s+on\s+youtube/i);
  if (youtubeMatch?.[1]) {
    return `${youtubeMatch[1]} site:youtube.com`;
  }

  if (/nifty/i.test(text) && /\b30\b/.test(text) && /trading day/i.test(text)) {
    return "Nifty index data analysis last 30 trading days";
  }

  return text;
}

function buildAlternativeQueries(query) {
  const cleaned = cleanText(query);
  if (!cleaned) return [];

  const alternatives = [];
  const financeIntent = /\b(nifty|sensex|stock|market|trading|index|share price)\b/i.test(cleaned);

  if (financeIntent) {
    alternatives.push(`${cleaned} site:nseindia.com`);
    alternatives.push(`${cleaned} site:finance.yahoo.com`);
    alternatives.push(`${cleaned} site:moneycontrol.com`);
  }

  return [...new Set(alternatives)];
}

function buildSubAgentFallbackSummary({ name, instructions, outputs }) {
  const cleanedOutputs = outputs
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);

  if (!cleanedOutputs.length) {
    return `Sub-agent ${name} could not gather enough information for: ${instructions || "No instructions provided."}`;
  }

  if (cleanedOutputs.length === 1) {
    return cleanedOutputs[0];
  }

  return [
    `Sub-agent ${name} completed the task.`,
    instructions ? `Task: ${instructions}` : "",
    "",
    ...cleanedOutputs.map((item, index) => `Result ${index + 1}:\n${item}`)
  ]
    .filter(Boolean)
    .join("\n");
}

async function summarizeSubAgentOutputs({ name, instructions, outputs }) {
  const cleanedOutputs = outputs
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);

  if (!cleanedOutputs.length) {
    return {
      output: buildSubAgentFallbackSummary({ name, instructions, outputs: cleanedOutputs }),
      usedAI: false
    };
  }

  if (!isSubAgentLlmAvailable()) {
    return {
      output: buildSubAgentFallbackSummary({ name, instructions, outputs: cleanedOutputs }),
      usedAI: false
    };
  }

  const prompt = [
    `Sub-agent name: ${name}`,
    instructions ? `Task: ${instructions}` : "Task: Complete the delegated request.",
    "",
    "Use the collected tool outputs below to produce the final user-facing answer.",
    "If the data is incomplete, say what is missing and still provide the most useful partial answer.",
    "Do not mention internal tools or say 'prepared task'.",
    "",
    cleanedOutputs.map((item, index) => `Tool output ${index + 1}:\n${item}`).join("\n\n")
  ].join("\n");

  try {
    const response = await subAgentClient.chat.completions.create({
      model: subAgentModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a delegated execution agent. Convert collected tool outputs into a direct, useful final answer for the end user."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const summary = response.choices?.[0]?.message?.content?.trim();
    if (summary) {
      return {
        output: summary,
        usedAI: true
      };
    }
  } catch (error) {
    console.log("Sub-agent synthesis failed:", error?.message || error);
  }

  return {
    output: buildSubAgentFallbackSummary({ name, instructions, outputs: cleanedOutputs }),
    usedAI: false
  };
}

export async function subAgent(subAgentNameOrArgs, args) {
  const request = buildSubAgentRequest(subAgentNameOrArgs, args);
  const name = inferSubAgentName(request);
  const instructions = cleanText(request.instructions);
  const capabilities = Array.isArray(request.capabilities)
    ? request.capabilities.filter(Boolean).map((item) => cleanText(item))
    : [];
  const outputs = []
    .concat(request.outputs || [])
    .filter((item) => item !== undefined && item !== null)
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item, null, 2)));

  if (capabilities.includes("searchWeb") && instructions) {
    const query = deriveSearchQueryFromInstructions(instructions);
    const searchResult = await searchWeb({ query });
    outputs.push(searchResult);
  }

  if (capabilities.includes("executeCommand") && cleanText(request.command)) {
    const commandResult = await executeCommand({ command: request.command });
    if (commandResult?.success === false) {
      outputs.push(`Command failed: ${commandResult.error}`);
    } else if (typeof commandResult?.output === "string") {
      outputs.push(commandResult.output);
    }
  }

  if (capabilities.includes("accessAPI") && request.apiEndpoint) {
    const apiResult = await accessAPI({
      endpoint: request.apiEndpoint,
      params: request.apiParams || {}
    });
    outputs.push(
      apiResult?.success === false
        ? `API request failed: ${apiResult.error}`
        : JSON.stringify(apiResult.data ?? apiResult, null, 2)
    );
  }

  if (!outputs.length && instructions) {
    outputs.push(await searchWeb({ query: deriveSearchQueryFromInstructions(instructions) }));
  }

  const { output, usedAI } = await summarizeSubAgentOutputs({
    name,
    instructions,
    outputs
  });

  return {
    success: true,
    action: "subAgent",
    name,
    output,
    usedAI,
    args: {
      instructions,
      capabilities,
      ...(request.command ? { command: request.command } : {}),
      ...(request.apiEndpoint ? { apiEndpoint: request.apiEndpoint } : {})
    }
  };
}

export async function createFile({ path: filePath, content, previous_result }) {
  const resolvedContent = content ?? previous_result;

  if (!filePath || resolvedContent === undefined) {
    return { success: false, error: "path and content are required" };
  }

  const resolvedPath = resolveWritableFilePath(filePath);

  const serializableContent =
    typeof resolvedContent === "string"
      ? resolvedContent
      : JSON.stringify(resolvedContent, null, 2);

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, serializableContent);

  return {
    success: true,
    path: resolvedPath,
    bytes: Buffer.byteLength(serializableContent, "utf8")
  };
}

function resolveWritableFilePath(filePath) {
  const rawPath = String(filePath).trim();

  if (rawPath.startsWith("/path/to/")) {
    return path.join(process.cwd(), "generated", path.basename(rawPath) || "generated.txt");
  }

  if (rawPath.startsWith("~/")) {
    return path.join(process.env.HOME || process.cwd(), rawPath.slice(2));
  }

  return path.resolve(process.cwd(), rawPath);
}

export async function openApplication(args = {}) {
  try {
    const appName = cleanText(args.appName || args.app || args.name || args.application);

    if (!appName) {
      return { success: false, error: "appName is required" };
    }
    if (/[\/\\;&|><`$]/.test(appName)) {
      return { success: false, error: "appName contains unsafe characters" };
    }

    execFileSync("open", ["-a", appName], { stdio: "pipe" });

    return {
      success: true,
      action: "openApplication",
      appName
    };
  } catch (error) {
    return {
      success: false,
      error: error.stderr?.toString()?.trim() || error.message
    };
  }
}

export async function searchWeb({ query }) {
  if (!query) {
    return "Error: query is required";
  }

  try {
    const normalizedQuery = buildSearchQuery(query);
    const preferNews = isNewsIntent(normalizedQuery) && !isQuestionIntent(normalizedQuery);
    const candidateQueries = [normalizedQuery, ...buildAlternativeQueries(normalizedQuery)];

    for (const candidateQuery of candidateQueries) {
      if (preferNews) {
        const newsResults = await searchGoogleNewsRss(candidateQuery).catch(() => []);
        if (newsResults.length) {
          const rankedNews = rerankResultsForIntent(newsResults, candidateQuery);
          const enrichedNews = await enrichResultsWithSummaries(rankedNews);
          return formatSearchResults(query, enrichedNews);
        }
      }

      const providers = [
        () => searchDuckDuckGoByFetch(candidateQuery),
        () => searchBingByFetch(candidateQuery)
      ];

      let links = [];

      for (const runProvider of providers) {
        const fetched = await runProvider().catch(() => ({
          links: [],
          results: []
        }));

        if (fetched.results.length) {
          const rankedFetched = rerankResultsForIntent(fetched.results, candidateQuery);
          const enrichedFetched = await enrichResultsWithSummaries(rankedFetched);
          return formatSearchResults(query, enrichedFetched);
        }

        if (fetched.links.length) {
          links = fetched.links;
          break;
        }
      }

      if (!links.length) {
        links = await searchDuckDuckGoByBrowser(candidateQuery).catch(() => []);
      }

      if (!links.length) {
        links = await searchBingByBrowser(candidateQuery).catch(() => []);
      }

      if (!links.length && !preferNews) {
        const newsResults = await searchGoogleNewsRss(candidateQuery).catch(() => []);
        if (newsResults.length) {
          const rankedNews = rerankResultsForIntent(newsResults, candidateQuery);
          const enrichedNews = await enrichResultsWithSummaries(rankedNews);
          return formatSearchResults(query, enrichedNews);
        }
      }

      if (!links[0]) {
        continue;
      }

      const scraped = await scrapePage(links[0]);
      if (typeof scraped === "string" && scraped.trim()) {
        return scraped;
      }

      const fallback = links.slice(0, 5).map((link) => ({
        title: link,
        snippet: "",
        link,
        source: domainFromUrl(link),
        publishedAt: ""
      }));
      const enrichedFallback = await enrichResultsWithSummaries(fallback);
      return formatSearchResults(query, enrichedFallback);
    }

    return `No search results found for "${query}".`;
  } catch (error) {
    const clean = String(error?.message || "searchWeb failed").split("\n")[0].trim();
    return `Unable to fetch live web results right now. ${clean}`;
  }
}

export async function scrapePage(url) {
  if (!url) {
    return { success: false, error: "url is required" };
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_UA
      }
    });

    if (res.ok) {
      const html = await res.text();
      const text = toPlainText(html).slice(0, 5000);
      if (text) return text;
    }
  } catch {
    // Fall through to the browser fallback.
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      userAgent: DEFAULT_UA
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 5000) || "");
    if (!text) {
      return { success: false, error: "Could not extract text from page" };
    }
    return text;
  } catch (error) {
    return {
      success: false,
      error: error?.message || "scrapePage failed"
    };
  } finally {
    await browser.close();
  }
}

export async function accessAPI({ endpoint, apiEndpoint, params }) {
  try {
    const resolvedEndpoint = endpoint || apiEndpoint;
    if (!resolvedEndpoint) {
      return { success: false, error: "endpoint is required" };
    }

    const method = String(params?.method || "GET").toUpperCase();
    const headers = {
      "Content-Type": "application/json",
      ...(params?.headers && typeof params.headers === "object" ? params.headers : {})
    };
    const url = new URL(resolvedEndpoint);

    if (method === "GET" && params?.query && typeof params.query === "object") {
      for (const [key, value] of Object.entries(params.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const requestInit = {
      method,
      headers
    };

    if (method !== "GET" && params?.body !== undefined) {
      requestInit.body =
        typeof params.body === "string" ? params.body : JSON.stringify(params.body);
    } else if (method !== "GET" && params && params.body === undefined) {
      requestInit.body = JSON.stringify(params);
    }

    const res = await fetch(url, requestInit);
    const raw = await res.text();

    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }

    return {
      success: res.ok,
      status: res.status,
      data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
