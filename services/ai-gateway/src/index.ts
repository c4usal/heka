interface Env {
  OPENAI_API_KEY?: string;
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_MODEL?: string;
  GROQ_MODEL: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

function extractUserQuestion(body: Record<string, unknown>): string {
  const messages = body.messages as Array<{ role?: string; content?: string }>;
  return messages.filter((message) => message.role === "user").map((message) => message.content ?? "").join("\n").trim();
}

async function gatherOpenResearch(question: string): Promise<string> {
  const query = question.slice(0, 240);
  const snippets: string[] = [];
  try {
    const ddg = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      headers: { "User-Agent": "Heka AI Gateway/0.1 (https://github.com/c4usal/heka)" },
    });
    if (ddg.ok) {
      const payload = await ddg.json<{ AbstractText?: string; Heading?: string; RelatedTopics?: Array<{ Text?: string; FirstURL?: string }> }>();
      if (payload.AbstractText) snippets.push(`DuckDuckGo: ${payload.Heading ? `${payload.Heading} — ` : ""}${payload.AbstractText}`);
      for (const topic of (payload.RelatedTopics ?? []).slice(0, 4)) {
        if (topic.Text) snippets.push(`Related: ${topic.Text}`);
      }
    }
  } catch { /* open research is best-effort */ }

  try {
    const search = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json`, {
      headers: { "User-Agent": "Heka AI Gateway/0.1 (https://github.com/c4usal/heka)" },
    });
    if (search.ok) {
      const payload = await search.json<[string, string[], string[], string[]]>();
      const titles = payload[1] ?? [];
      for (const title of titles.slice(0, 2)) {
        const summary = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
          headers: { "User-Agent": "Heka AI Gateway/0.1 (https://github.com/c4usal/heka)" },
        });
        if (!summary.ok) continue;
        const page = await summary.json<{ extract?: string; title?: string }>();
        if (page.extract) snippets.push(`Wikipedia (${page.title ?? title}): ${page.extract.slice(0, 500)}`);
      }
    }
  } catch { /* open research is best-effort */ }

  if (snippets.length === 0) return "";
  return `\n\nOPEN SOURCE RESEARCH CONTEXT (DuckDuckGo + Wikipedia; use for place/facts grounding; never invent coordinates or claim this is authoritative GIS data):\n${snippets.map((item) => `- ${item}`).join("\n")}`;
}

function withResearchContext(body: Record<string, unknown>, research: string): Record<string, unknown> {
  if (!research) return body;
  const messages = [...(body.messages as Array<{ role?: string; content?: string }>)];
  const lastUser = [...messages].reverse().findIndex((message) => message.role === "user");
  if (lastUser < 0) return body;
  const index = messages.length - 1 - lastUser;
  messages[index] = { ...messages[index], content: `${messages[index].content ?? ""}${research}` };
  return { ...body, messages };
}

async function requestOpenAI(body: Record<string, unknown>, apiKey: string, model: string): Promise<Response> {
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, model, temperature: body.temperature ?? 0.1, stream: false, max_tokens: body.max_tokens ?? 2500 }),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", ...corsHeaders },
  });
}

async function requestGroq(body: Record<string, unknown>, apiKey: string, model: string): Promise<Response> {
  const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, model, temperature: body.temperature ?? 0.1, stream: false, max_tokens: body.max_tokens ?? 2500 }),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", ...corsHeaders },
  });
}

async function requestGemini(body: Record<string, unknown>, apiKey: string): Promise<Response> {
  const messages = body.messages as Array<{ role?: string; content?: string }>;
  const system = messages.filter((message) => message.role === "system").map((message) => message.content ?? "").join("\n\n");
  const prompt = messages.filter((message) => message.role !== "system").map((message) => message.content ?? "").join("\n\n");
  const schema = (body.response_format as { json_schema?: { schema?: unknown } } | undefined)?.json_schema?.schema;
  const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: schema
        ? { temperature: 0.1, responseMimeType: "application/json", responseJsonSchema: schema }
        : { temperature: 0.1, responseMimeType: "application/json" },
    }),
  });
  const payload = await upstream.json<unknown>();
  if (!upstream.ok) return json(payload, upstream.status);
  const content = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!content) return json({ error: { message: "Gemini returned an empty result." } }, 502);
  return json({ model: "gemini-2.5-flash", choices: [{ message: { content } }] });
}

const retryable = new Set([429, 500, 502, 503, 504]);

/**
 * LLM gateway: structured planner OR tool-calling agent completions.
 * Secrets stay here; Earth tools execute on heka-web.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") {
      return json({ error: { message: "Use POST /v1/chat/completions." } }, 404);
    }
    let body: Record<string, unknown>;
    try { body = await request.json<Record<string, unknown>>(); }
    catch { return json({ error: { message: "Request body must be JSON." } }, 400); }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return json({ error: { message: "messages are required." } }, 400);
    }
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    const hasSchema = !!body.response_format;
    if (!hasTools && !hasSchema) {
      return json({ error: { message: "Provide response_format (planner) or tools (agent)." } }, 400);
    }
    if (!env.OPENAI_API_KEY && !env.GROQ_API_KEY && !env.GEMINI_API_KEY) {
      return json({ error: { message: "No planner provider key is configured on the Heka AI gateway." } }, 503);
    }

    try {
      // Skip research when caller already supplied OPEN WEB RESULTS (Earth Agent / grounded prompts).
      const isToolRound = (body.messages as Array<{ role?: string }>).some((m) => m.role === "tool");
      const alreadyGrounded = (body.messages as Array<{ content?: string }>).some((m) =>
        typeof m.content === "string" && /OPEN WEB RESULTS|BEST EXTRACT|GIS_RECOMMENDATION/.test(m.content),
      );
      const enriched = hasTools || isToolRound || alreadyGrounded
        ? body
        : withResearchContext(body, await gatherOpenResearch(extractUserQuestion(body)));
      const openaiModel = env.OPENAI_MODEL || "gpt-4.1-mini";

      if (env.OPENAI_API_KEY) {
        const openai = await requestOpenAI(enriched, env.OPENAI_API_KEY, openaiModel);
        if (openai.ok || (!env.GROQ_API_KEY && !env.GEMINI_API_KEY) || !retryable.has(openai.status)) return openai;
      }

      if (env.GROQ_API_KEY) {
        // Groq tool calling: pass tools through when present
        const groq = await requestGroq(enriched, env.GROQ_API_KEY, env.GROQ_MODEL);
        if (groq.ok || !env.GEMINI_API_KEY || !retryable.has(groq.status)) return groq;
      }

      // Gemini path does not fully support OpenAI tool_calls — only for schema planner.
      if (env.GEMINI_API_KEY && hasSchema && !hasTools) return requestGemini(enriched, env.GEMINI_API_KEY);
      return json({ error: { message: "All configured planner providers failed." } }, 502);
    } catch {
      return json({ error: { message: "The Heka AI gateway could not reach its planner provider." } }, 502);
    }
  },
};
