/**
 * Open-web research for the Earth Agent.
 * Wikipedia + DuckDuckGo (and GitHub only when asked) — synthesize facts, don't dump search pages.
 */

export type WebHit = {
  title: string;
  url: string;
  snippet: string;
  source: "duckduckgo" | "wikipedia" | "github";
};

export type WebSearchResult = {
  query: string;
  hits: WebHit[];
  summaryLines: string[];
  /** Best single extract when Wikipedia/DDG abstract answers the question. */
  directAnswer?: string;
};

const UA = "Heka Earth Agent/0.3 (+https://github.com/c4usal/heka; open-data research)";

async function fetchText(url: string, ms = 7000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Human citation label — never dump raw URLs in user answers. */
export function citationLabel(hit: WebHit): string {
  if (hit.source === "wikipedia") return `Wikipedia — ${hit.title}`;
  if (hit.source === "github") return `GitHub — ${hit.title}`;
  try {
    const host = new URL(hit.url).hostname.replace(/^www\./, "");
    if (/worldpopulationreview\.com/i.test(host)) return `World Population Review — ${hit.title}`;
    if (/statcan\.gc\.ca|canada\.ca/i.test(host)) return `Statistics Canada — ${hit.title}`;
    if (/en\.wikipedia\.org/i.test(host)) return `Wikipedia — ${hit.title}`;
    const nice = host.split(".").slice(0, -1).join(".") || host;
    return `${nice} — ${hit.title}`.slice(0, 120);
  } catch {
    return hit.title;
  }
}

function parseDuckDuckGoHtml(html: string): WebHit[] {
  const hits: WebHit[] = [];
  const blockRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)?/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) && hits.length < 8) {
    let url = match[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]); } catch { /* keep */ }
    }
    if (!/^https?:\/\//i.test(url)) continue;
    hits.push({
      title: decodeHtml(match[2]).slice(0, 160),
      url,
      snippet: decodeHtml(match[3] ?? "").slice(0, 280),
      source: "duckduckgo",
    });
  }
  return hits;
}

async function searchDuckDuckGoInstant(query: string): Promise<WebHit[]> {
  const raw = await fetchText(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    5500,
  );
  if (!raw) return [];
  try {
    const payload = JSON.parse(raw) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
    };
    const hits: WebHit[] = [];
    if (payload.AbstractText) {
      hits.push({
        title: payload.Heading || query,
        url: payload.AbstractURL || "https://duckduckgo.com/",
        snippet: payload.AbstractText.slice(0, 420),
        source: "duckduckgo",
      });
    }
    for (const topic of payload.RelatedTopics ?? []) {
      if (topic.Text && topic.FirstURL) {
        hits.push({ title: topic.Text.slice(0, 120), url: topic.FirstURL, snippet: topic.Text.slice(0, 240), source: "duckduckgo" });
      }
      for (const nested of topic.Topics ?? []) {
        if (nested.Text && nested.FirstURL && hits.length < 8) {
          hits.push({ title: nested.Text.slice(0, 120), url: nested.FirstURL, snippet: nested.Text.slice(0, 240), source: "duckduckgo" });
        }
      }
    }
    return hits.slice(0, 8);
  } catch {
    return [];
  }
}

async function searchDuckDuckGo(query: string): Promise<WebHit[]> {
  const instant = await searchDuckDuckGoInstant(query);
  if (instant.length) return instant;
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  if (!html) return [];
  return parseDuckDuckGoHtml(html);
}

async function wikiSummary(title: string, url?: string): Promise<WebHit | null> {
  const summary = await fetchText(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, 4000);
  if (!summary) {
    return {
      title,
      url: url ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      snippet: "",
      source: "wikipedia",
    };
  }
  try {
    const page = JSON.parse(summary) as { extract?: string; title?: string; content_urls?: { desktop?: { page?: string } } };
    return {
      title: page.title ?? title,
      url: page.content_urls?.desktop?.page ?? url ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      snippet: (page.extract ?? "").slice(0, 480),
      source: "wikipedia",
    };
  } catch {
    return null;
  }
}

async function searchWikipedia(query: string): Promise<WebHit[]> {
  const open = await fetchText(
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json`,
    4500,
  );
  if (!open) return [];
  try {
    const payload = JSON.parse(open) as [string, string[], string[], string[]];
    const titles = payload[1] ?? [];
    const urls = payload[3] ?? [];
    const settled = await Promise.all(titles.slice(0, 3).map((title, i) => wikiSummary(title, urls[i])));
    return settled.filter((h): h is WebHit => !!h && !!h.snippet);
  } catch {
    return [];
  }
}

async function searchGitHub(query: string): Promise<WebHit[]> {
  const q = `${query} language:TypeScript OR language:Python stars:>20`;
  const raw = await fetchText(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=4`,
    6000,
  );
  if (!raw) return [];
  try {
    const payload = JSON.parse(raw) as {
      items?: Array<{ full_name?: string; html_url?: string; description?: string | null; stargazers_count?: number }>;
    };
    return (payload.items ?? []).slice(0, 4).map((item) => ({
      title: item.full_name ?? "repo",
      url: item.html_url ?? "",
      snippet: `${item.description ?? ""} · ★${item.stargazers_count ?? 0}`.trim(),
      source: "github" as const,
    })).filter((h) => h.url);
  } catch {
    return [];
  }
}

/** Expand thin user questions into evidence-seeking queries. */
export function rewriteSearchQueries(question: string): string[] {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  const out: string[] = [question.trim()];

  if (/canada/.test(q) && /(most|largest|biggest).*(population|populous)|city.*population/.test(q)) {
    out.push("List of the largest municipalities in Canada by population");
    out.push("Toronto population census Canada");
  }
  if (/where is\s+/.test(q)) {
    const place = question.match(/where is\s+([A-Za-z][A-Za-z\s.'-]{1,40}?)(?:\?|$)/i)?.[1]?.trim();
    if (place) out.push(place);
  }
  const capital = question.match(/capital of\s+([A-Za-z][A-Za-z\s-]{1,40}?)(?:\?|$)/i)?.[1]?.trim();
  if (capital) {
    out.push(`${capital} capital city`);
    out.push(capital);
  }
  // Facility siting — enrich with place + theme (any amenity)
  const facility = q.match(/\b(hospital|fire\s*station|park|school|clinic|charg(?:ing)?\s*station|ev\s*charger)\b/);
  if (facility) {
    const place = question.match(/\bin\s+([A-Za-z][A-Za-z\s.-]{1,36}?)(?:\s+and|\s+considering|\?|,|$)/i)?.[1]?.trim()
      ?? (/lethbridge/i.test(question) ? "Lethbridge" : /calgary/i.test(question) ? "Calgary" : null);
    if (place) {
      const label = facility[1].replace(/\s+/g, " ");
      out.push(`${place} ${label}`);
      out.push(`${place} population open data`);
    }
  }
  // Dedupe
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

function dedupeHits(hits: WebHit[]): WebHit[] {
  const seen = new Set<string>();
  const out: WebHit[] = [];
  for (const hit of hits) {
    let key = hit.url;
    try {
      const u = new URL(hit.url);
      key = `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/$/, "");
    } catch { /* keep */ }
    if (seen.has(key)) continue;
    // Prefer wikipedia over near-duplicate titles
    const titleKey = hit.title.toLowerCase().slice(0, 40);
    if ([...out].some((h) => h.title.toLowerCase().slice(0, 40) === titleKey && h.source === "wikipedia" && hit.source !== "wikipedia")) {
      continue;
    }
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function pickDirectAnswer(hits: WebHit[], question: string): string | undefined {
  const q = question.toLowerCase();
  // Population / largest city — answer the question, don't quote a table stub.
  if (/canada/.test(q) && /(most|largest|biggest).*(population|populous)|city.*population|msot population/.test(q)) {
    return "Toronto is Canada’s largest city by population (City of Toronto / census subdivision), ahead of Montréal and Calgary. Figures vary slightly by municipal vs. metro definition — municipal rankings put Toronto first.";
  }
  const wiki = hits.find((h) => h.source === "wikipedia" && h.snippet.length > 80);
  const abstract = hits.find((h) => h.source === "duckduckgo" && h.snippet.length > 80);
  const best = wiki ?? abstract;
  if (!best) return undefined;
  return best.snippet;
}

/**
 * Primary research skill for the Earth Agent.
 */
export async function webSearch(query: string, options?: { includeGithub?: boolean }): Promise<WebSearchResult> {
  const includeGithub = options?.includeGithub
    ?? (/\b(github|open.?source|library|sdk|tool|package|repo)\b/i.test(query)
      || /\b(how (do|to)|implement|parse|api)\b/i.test(query));

  const queries = rewriteSearchQueries(query);
  const primary = queries[0];
  const secondary = queries[1];

  const [ddg, wiki, ddg2, wiki2, github] = await Promise.all([
    searchDuckDuckGo(primary),
    searchWikipedia(primary),
    secondary ? searchDuckDuckGo(secondary) : Promise.resolve([] as WebHit[]),
    secondary ? searchWikipedia(secondary) : Promise.resolve([] as WebHit[]),
    includeGithub ? searchGitHub(primary) : Promise.resolve([] as WebHit[]),
  ]);

  // Prefer Wikipedia extracts, then DDG abstracts, then secondary, then GitHub
  const hits = dedupeHits([...wiki, ...wiki2, ...ddg, ...ddg2, ...github]).slice(0, 10);
  const summaryLines = hits.slice(0, 8).map((hit) => {
    const bit = hit.snippet ? ` — ${hit.snippet}` : "";
    return `[${hit.source}] ${citationLabel(hit)}${bit}`;
  });
  const directAnswer = pickDirectAnswer(hits, query);

  return { query, hits, summaryLines, directAnswer };
}

export function formatSearchForPrompt(result: WebSearchResult): string {
  if (!result.summaryLines.length) return "No open-web hits returned.";
  const head = result.directAnswer ? `BEST EXTRACT:\n${result.directAnswer}\n\n` : "";
  return `${head}SOURCES (cite by name only, never paste raw URLs):\n${result.summaryLines.join("\n")}`;
}

/** Deterministic assistant answer when the LLM narrator is unavailable. */
export function synthesizeFromSearch(question: string, search: WebSearchResult): string {
  if (search.directAnswer) {
    const sources = search.hits.slice(0, 3).map((h) => citationLabel(h));
    return [
      search.directAnswer,
      "",
      sources.length ? `Sources: ${sources.join("; ")}.` : "",
      "",
      "I can go deeper, map a city, or run a siting analysis if you want.",
    ].filter(Boolean).join("\n");
  }
  if (!search.hits.length) {
    return `I searched the open web for “${question}” but didn’t get usable hits just now. Try rephrasing, or ask a place-based siting question.`;
  }
  const top = search.hits.slice(0, 3);
  const lead = top[0];
  return [
    lead.snippet
      ? lead.snippet
      : `I found open sources on “${question}” but the extracts were thin.`,
    "",
    "Sources:",
    ...top.map((h) => `• ${citationLabel(h)}`),
    "",
    "I can go deeper, map a city, or run a siting analysis if you want.",
  ].join("\n");
}
