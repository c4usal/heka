interface Env {
  GROQ_API_KEY: string;
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

/**
 * Small serverless bridge: Heka sends its versioned prompt and JSON Schema, the
 * Worker holds the provider secret. It deliberately does not execute GIS code.
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
    if (!Array.isArray(body.messages) || body.messages.length === 0 || !body.response_format) {
      return json({ error: { message: "A structured planner request requires messages and response_format." } }, 400);
    }
    try {
      const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model: env.GROQ_MODEL, temperature: 0.1, stream: false, max_tokens: 1800 }),
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", ...corsHeaders },
      });
    } catch {
      return json({ error: { message: "The Heka AI gateway could not reach its planner provider." } }, 502);
    }
  },
};
