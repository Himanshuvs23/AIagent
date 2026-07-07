import fetch from "node-fetch";
import { chromium } from "playwright";
import * as cheerio from "cheerio";

export const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function normalizeUrl(rawUrl = "") {
  if (!rawUrl) return "";
  let next = rawUrl.trim();
  if (next.startsWith("//")) next = `https:${next}`;
  try {
    const parsed = new URL(next);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
    if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname === "/y.js") {
      return "";
    }
    if (parsed.hostname.includes("bing.com") && parsed.pathname.includes("/aclick")) {
      return "";
    }
    return parsed.toString();
  } catch {
    return next;
  }
}

export function toPlainText(html = "") {
  const $ = cheerio.load(html);
  return $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function truncateText(value = "", maxLength = 260) {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function extractSentenceSummary(value = "", maxSentences = 2) {
  const text = cleanText(value);
  if (!text) return "";
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return truncateText(text, 320);
  return truncateText(sentences.slice(0, maxSentences).join(" "), 420);
}

export function domainFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatDate(dateValue = "") {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return cleanText(dateValue);
  return d.toISOString().slice(0, 10);
}

function queryTokens(query = "") {
  return cleanText(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length > 2);
}

function hasAnyKeyword(text = "", keywords = []) {
  const lower = cleanText(text).toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

export function isNewsIntent(query = "") {
  return hasAnyKeyword(query, [
    "news",
    "latest",
    "breaking",
    "headline",
    "headlines",
    "today",
    "updates"
  ]);
}

export function isQuestionIntent(query = "") {
  return hasAnyKeyword(query, [
    "question",
    "questions",
    "mcq",
    "quiz",
    "practice",
    "aptitude",
    "interview",
    "important",
    "asked",
    "exam"
  ]);
}

export function buildSearchQuery(query = "") {
  const base = cleanText(query);
  if (!base) return base;
  if (isQuestionIntent(base) && !hasAnyKeyword(base, ["answer", "answers"])) {
    return `${base} with answers practice`;
  }
  return base;
}

export function rerankResultsForIntent(results, query = "") {
  if (!Array.isArray(results) || !results.length) return [];
  const tokens = queryTokens(query);
  const questionIntent = isQuestionIntent(query);

  const bannedSourcesForQuestions = ["news.google.com", "reuters.com", "apnews.com"];

  const scored = results
    .map((item) => {
      const hay = `${item.title || ""} ${item.snippet || ""}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 1;
      }
      if (questionIntent) {
        if (hasAnyKeyword(hay, ["question", "questions", "mcq", "quiz", "practice", "aptitude"])) score += 4;
        if (hasAnyKeyword(hay, ["answer", "answers", "solution"])) score += 2;
      }
      if (item.source && bannedSourcesForQuestions.includes(item.source) && questionIntent) score -= 3;
      return { ...item, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, 5)
    .map(({ _score, ...rest }) => rest);

  return scored;
}

function extractSearchLinks(html = "") {
  const $ = cheerio.load(html);
  const selectors = [
    'a[data-testid="result-title-a"]',
    "a.result__a",
    "h2 a",
    "a[href]"
  ];
  const links = [];
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      if (links.length >= 8) return false;
      const href = normalizeUrl($(el).attr("href") || "");
      if (!href.startsWith("http")) return;
      if (href.includes("duckduckgo.com/y.js")) return;
      if (!links.includes(href)) links.push(href);
    });
    if (links.length >= 5) break;
  }
  return links;
}

function extractSearchResults(html = "") {
  const $ = cheerio.load(html);
  const results = [];

  const containers = [
    ".result",
    ".result.results_links",
    ".web-result",
    ".b_algo",
    "[data-layout='organic']",
    ".results_links"
  ];

  for (const container of containers) {
    $(container).each((_, el) => {
      if (results.length >= 8) return false;

      const root = $(el);
      const titleAnchor = root.find('a.result__a, a[data-testid="result-title-a"], h2 a').first();
      const href = normalizeUrl(titleAnchor.attr("href") || "");
      const title = cleanText(titleAnchor.text());
      const snippet = cleanText(
        root
          .find(".result__snippet, .result-snippet, [data-result='snippet'], .result__body, .b_caption p")
          .first()
          .text()
      );

      if (!href.startsWith("http")) return;
      if (/^\s*ad\b/i.test(title) || /^\s*ad\b/i.test(snippet)) return;
      if (!title && !snippet) return;
      if (results.some((item) => item.link === href)) return;

      results.push({
        title: title || href,
        snippet: truncateText(snippet),
        link: href,
        source: domainFromUrl(href),
        publishedAt: ""
      });
    });

    if (results.length >= 5) break;
  }

  if (!results.length) {
    const links = extractSearchLinks(html).slice(0, 5);
    return links.map((link) => ({
      title: link,
      snippet: "",
      link,
      source: domainFromUrl(link),
      publishedAt: ""
    }));
  }

  return results.slice(0, 5);
}

export function formatSearchResults(query, results) {
  if (!results.length) return `No web results found for "${query}".`;

  const quickSummary = results
    .map((item) => extractSentenceSummary(item.snippet || item.title, 1))
    .filter(Boolean)
    .slice(0, 3);

  const lines = [`Research summary for "${query}"`, ""];
  if (quickSummary.length) {
    lines.push("Quick takeaways:");
    quickSummary.forEach((point, idx) => {
      lines.push(`- ${idx + 1}) ${point}`);
    });
    lines.push("");
  }

  lines.push("Detailed sources:");
  lines.push("");
  results.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item.title}`);
    if (item.source) lines.push(`Source: ${item.source}`);
    if (item.publishedAt) lines.push(`Date: ${item.publishedAt}`);
    if (item.snippet) lines.push(`Summary: ${truncateText(item.snippet)}`);
    lines.push(`Link: ${item.link}`);
    lines.push("");
  });
  lines.push("Open any Link to read full article.");
  return lines.join("\n");
}

async function fetchArticleSummary(url) {
  if (!url || !url.startsWith("http")) return "";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_UA
      }
    });
    if (!res.ok) return "";
    const html = await res.text();
    const $ = cheerio.load(html);
    const articleText = cleanText(
      $("article").text() ||
        $("main").text() ||
        $("p")
          .slice(0, 20)
          .map((_, el) => $(el).text())
          .get()
          .join(" ")
    );
    return extractSentenceSummary(articleText, 2);
  } catch {
    return "";
  }
}

export async function enrichResultsWithSummaries(results) {
  const enriched = [];
  for (const item of results.slice(0, 5)) {
    let bestSummary = extractSentenceSummary(item.snippet, 2);
    const remoteSummary = await fetchArticleSummary(item.link);
    if (remoteSummary && remoteSummary.length > 60) {
      bestSummary = remoteSummary;
    }
    enriched.push({
      ...item,
      snippet: bestSummary || extractSentenceSummary(item.title, 1)
    });
  }
  return enriched;
}

export async function searchGoogleNewsRss(query) {
  const endpoint = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(endpoint, {
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8"
    }
  });
  if (!res.ok) return [];

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $("item").each((_, el) => {
    if (items.length >= 6) return false;
    const title = cleanText($(el).find("title").first().text());
    const link = cleanText($(el).find("link").first().text());
    const pubDate = cleanText($(el).find("pubDate").first().text());
    const source = cleanText($(el).find("source").first().text());
    const descriptionRaw = $(el).find("description").first().text();
    const description = truncateText(cheerio.load(descriptionRaw).text());
    if (!title || !link) return;
    items.push({
      title,
      link,
      source: source || domainFromUrl(link),
      publishedAt: formatDate(pubDate),
      snippet: description
    });
  });
  return items;
}

export async function searchDuckDuckGoByFetch(query) {
  const endpoints = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}`
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          "User-Agent": DEFAULT_UA
        }
      });
      if (!res.ok) continue;
      const html = await res.text();
      const results = extractSearchResults(html);
      if (results.length > 0) {
        return {
          links: results.map((item) => item.link),
          results
        };
      }
    } catch {
      // Try next endpoint.
    }
  }
  return { links: [], results: [] };
}

export async function searchBingByFetch(query) {
  const endpoints = [
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US`,
    `https://www.bing.com/search?cc=us&q=${encodeURIComponent(query)}`
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      if (!res.ok) continue;

      const html = await res.text();
      const results = extractSearchResults(html);
      if (results.length > 0) {
        return {
          links: results.map((item) => item.link),
          results
        };
      }
    } catch {
      // Try next endpoint.
    }
  }

  return { links: [], results: [] };
}

export async function searchDuckDuckGoByBrowser(query) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      userAgent: DEFAULT_UA
    });
    const page = await context.newPage();
    await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000
    });
    await page.waitForTimeout(1200);
    const links = await page.evaluate(() => {
      const selectors = [
        'a[data-testid="result-title-a"]',
        "a.result__a",
        "h2 a",
        "a[href]"
      ];
      const out = [];
      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((el) => {
          if (out.length >= 8) return;
          const href = el.getAttribute("href") || "";
          if (href && !out.includes(href)) out.push(href);
        });
        if (out.length >= 5) break;
      }
      return out;
    });
    return links.map(normalizeUrl).filter((href) => href.startsWith("http")).slice(0, 5);
  } finally {
    await browser.close();
  }
}

export async function searchBingByBrowser(query) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      userAgent: DEFAULT_UA
    });
    const page = await context.newPage();
    await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000
    });
    await page.waitForTimeout(1200);
    const links = await page.evaluate(() => {
      const nodes = document.querySelectorAll(".b_algo h2 a, h2 a, a[href]");
      const out = [];
      nodes.forEach((el) => {
        if (out.length >= 8) return;
        const href = el.getAttribute("href") || "";
        if (href && !out.includes(href)) out.push(href);
      });
      return out;
    });

    return links.map(normalizeUrl).filter((href) => href.startsWith("http")).slice(0, 5);
  } finally {
    await browser.close();
  }
}
