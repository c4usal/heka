import type { EarthResponse } from "./types";

const DEMO_PROMPTS = [
  "Where should I put a hospital in Calgary?",
  "Where should I put a bridge in Lagos?",
  "Where should I put an EV charger in Vancouver?",
] as const;

/** Canonical welcome / try-asking prompts — keep in sync with PlannerComposer. */
export const WELCOME_ASK_PROMPTS: readonly string[] = DEMO_PROMPTS;

const memory = new Map<string, { expires: number; value: EarthResponse }>();

export function normalizeAskQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Semantic cache key so long/short phrasings of the same siting ask share one entry.
 * e.g. "Where should Calgary build its next hospital…" → siting:hospital:calgary
 */
export function askCacheKey(question: string): string {
  const q = normalizeAskQuestion(question);
  const place =
    (q.match(/\b(?:in|around|near|at)\s+([a-z][a-z\s.-]{1,30}?)(?:\s+considering|\s+to\b|\s+and\b|$)/)?.[1]
      ?? q.match(/\bshould\s+([a-z]+)\s+build\b/)?.[1]
      ?? q.match(/\b(calgary|lagos|lethbridge|vancouver|toronto|london|edmonton|ottawa|winnipeg|montreal)\b/)?.[1]
      ?? "")
      .trim()
      .replace(/\s+/g, " ");

  let theme = "";
  if (/\bfire\s*station|firehall\b/.test(q)) theme = "fire_station";
  else if (/\bcharg|ev\s*station|electric\s*vehicle\b/.test(q)) theme = "charging_station";
  else if (/\bpark|playground\b/.test(q)) theme = "park";
  else if (/\bschool|university|college\b/.test(q)) theme = "school";
  else if (/\blibrary\b/.test(q)) theme = "library";
  else if (/\bclinic|doctors?\b/.test(q)) theme = "clinic";
  else if (/\bhospital|medical\s*centre|\ber\b/.test(q)) theme = "hospital";
  else if (/\bbridge|crossing\b/.test(q)) theme = "bridge";

  if (theme && place && /\b(where|best|should|build|put|site|locate|recommend)\b/.test(q)) {
    return `siting:${theme}:${place.split(" ").slice(0, 3).join(" ")}`;
  }
  return q;
}

function cacheRequest(key: string): Request {
  return new Request(`https://heka-earth-ask.internal/v2?k=${encodeURIComponent(key)}`, {
    method: "GET",
  });
}

export async function readAskCache(question: string): Promise<EarthResponse | null> {
  const key = askCacheKey(question);
  const mem = memory.get(key);
  if (mem && mem.expires > Date.now()) return mem.value;
  try {
    const hit = await caches.default.match(cacheRequest(key));
    if (!hit) return null;
    const value = await hit.json() as EarthResponse;
    memory.set(key, { expires: Date.now() + 3_600_000, value });
    return value;
  } catch {
    return null;
  }
}

export async function writeAskCache(question: string, response: EarthResponse, ttlSeconds = 21_600): Promise<void> {
  const key = askCacheKey(question);
  memory.set(key, { expires: Date.now() + ttlSeconds * 1000, value: response });
  try {
    const body = JSON.stringify(response);
    await caches.default.put(
      cacheRequest(key),
      new Response(body, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${ttlSeconds}`,
        },
      }),
    );
  } catch {
    /* cache is best-effort */
  }
}

export function isWelcomeAskPrompt(question: string): boolean {
  const key = askCacheKey(question);
  return DEMO_PROMPTS.some((p) => askCacheKey(p) === key) || key.startsWith("siting:");
}
