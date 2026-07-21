import {
  discoverBridgeSitingContext,
  discoverFacilityGapContext,
  discoverOsmDataset,
  geocodeScope,
} from "./osm";
import { runEarthAgent } from "./agent";

export interface Env {
  ASSETS: Fetcher;
  AI_GATEWAY_URL: string;
  WORLDPOP_API_KEY?: string;
  ORS_API_KEY?: string;
  EARTH_CACHE?: KVNamespace;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : "Request failed.";
  return json({ error: message }, status);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  return await request.json() as Record<string, unknown>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "heka-web", mode: "cloudflare", agent: true });
    }

    // Earth Agent — Ask Earth anything
    if (url.pathname === "/api/ask" && request.method === "POST") {
      try {
        const body = await readJson(request);
        const question = String(body.question ?? body.q ?? "").trim();
        if (!question) return errorResponse("question is required.");
        const result = await runEarthAgent(question, {
          AI_GATEWAY_URL: env.AI_GATEWAY_URL,
          WORLDPOP_API_KEY: env.WORLDPOP_API_KEY,
          ORS_API_KEY: env.ORS_API_KEY,
          EARTH_CACHE: env.EARTH_CACHE,
        });
        return json(result);
      } catch (error) {
        return errorResponse(error, 502);
      }
    }

    if (url.pathname === "/api/geocode" && request.method === "POST") {
      try {
        const body = await readJson(request);
        const geographicScope = String(body.geographicScope ?? body.q ?? "").trim();
        if (!geographicScope) return errorResponse("geographicScope is required.");
        return json(await geocodeScope(geographicScope));
      } catch (error) {
        return errorResponse(error, 502);
      }
    }

    if (url.pathname === "/api/osm/dataset" && request.method === "POST") {
      try {
        const body = await readJson(request);
        const datasetName = String(body.datasetName ?? "").trim();
        const geographicScope = String(body.geographicScope ?? "").trim();
        const kind = body.kind != null ? String(body.kind) : undefined;
        if (!datasetName || !geographicScope) return errorResponse("datasetName and geographicScope are required.");
        return json(await discoverOsmDataset(datasetName, geographicScope, kind));
      } catch (error) {
        return errorResponse(error, 502);
      }
    }

    if (url.pathname === "/api/osm/bridge-context" && request.method === "POST") {
      try {
        const body = await readJson(request);
        const geographicScope = String(body.geographicScope ?? "").trim();
        if (!geographicScope) return errorResponse("geographicScope is required.");
        return json(await discoverBridgeSitingContext(geographicScope));
      } catch (error) {
        return errorResponse(error, 502);
      }
    }

    if (url.pathname === "/api/osm/facility-context" && request.method === "POST") {
      try {
        const body = await readJson(request);
        const geographicScope = String(body.geographicScope ?? "").trim();
        const amenity = String(body.amenity ?? "hospital").trim() || "hospital";
        if (!geographicScope) return errorResponse("geographicScope is required.");
        return json(await discoverFacilityGapContext(geographicScope, amenity));
      } catch (error) {
        return errorResponse(error, 502);
      }
    }

    if (url.pathname === "/api/plan" && request.method === "POST") {
      try {
        const body = await readJson(request);
        const gateway = env.AI_GATEWAY_URL.replace(/\/$/, "");
        const upstream = await fetch(`${gateway}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await upstream.text();
        return new Response(payload, {
          status: upstream.status,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      } catch (error) {
        return errorResponse(error, 502);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return errorResponse("Unknown API route.", 404);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
