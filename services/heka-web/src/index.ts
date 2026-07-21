import {
  discoverBridgeSitingContext,
  discoverFacilityGapContext,
  discoverOsmDataset,
  geocodeScope,
} from "./osm";
import { runEarthAgent } from "./agent";
import { isWelcomeAskPrompt, readAskCache, WELCOME_ASK_PROMPTS, writeAskCache } from "./askCache";
import { demoFixtureForQuestion } from "./demoFixtures";

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

function json(value: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extraHeaders },
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "heka-web", mode: "cloudflare", agent: true, cache: true });
    }

    // Warm Try-asking prompts into Cache API (fixtures first = instant).
    if (url.pathname === "/api/ask/warmup" && request.method === "POST") {
      try {
        const warmed: string[] = [];
        for (const prompt of WELCOME_ASK_PROMPTS) {
          const fixture = demoFixtureForQuestion(prompt);
          if (fixture) {
            await writeAskCache(prompt, fixture, 86_400);
            warmed.push(prompt);
            continue;
          }
          const existing = await readAskCache(prompt);
          if (existing) {
            warmed.push(prompt);
            continue;
          }
          const result = await runEarthAgent(prompt, {
            AI_GATEWAY_URL: env.AI_GATEWAY_URL,
            WORLDPOP_API_KEY: env.WORLDPOP_API_KEY,
            ORS_API_KEY: env.ORS_API_KEY,
            EARTH_CACHE: env.EARTH_CACHE,
          });
          await writeAskCache(prompt, result, 86_400);
          warmed.push(prompt);
        }
        return json({ ok: true, warmed: warmed.length });
      } catch (error) {
        return errorResponse(error, 502);
      }
    }

    // Earth Agent — Ask Earth anything (Cache API for fast repeat / try-asking)
    if (url.pathname === "/api/ask" && request.method === "POST") {
      try {
        const body = await readJson(request);
        const question = String(body.question ?? body.q ?? "").trim();
        if (!question) return errorResponse("question is required.");

        const bypass = body.nocache === true || body.refresh === true;
        if (!bypass) {
          // Instant Try-asking / known demo siting keys first (no Overpass, no stale empty hits).
          const fixture = demoFixtureForQuestion(question);
          if (fixture) {
            ctx.waitUntil(writeAskCache(question, fixture, 86_400));
            return json(
              { ...fixture, engineNote: `${fixture.engineNote ?? "Earth Agent"} · fast` },
              200,
              { "X-Earth-Cache": "FIXTURE", "Cache-Control": "public, max-age=300" },
            );
          }
          const cached = await readAskCache(question);
          if (cached && (cached.candidates?.length ?? 0) > 0) {
            return json(
              { ...cached, engineNote: `${cached.engineNote ?? "Earth Agent"} · cached` },
              200,
              { "X-Earth-Cache": "HIT", "Cache-Control": "public, max-age=300" },
            );
          }
        }

        const result = await runEarthAgent(question, {
          AI_GATEWAY_URL: env.AI_GATEWAY_URL,
          WORLDPOP_API_KEY: env.WORLDPOP_API_KEY,
          ORS_API_KEY: env.ORS_API_KEY,
          EARTH_CACHE: env.EARTH_CACHE,
        });

        // If live OSM failed on a demo city, still return the fixture.
        if ((result.candidates?.length ?? 0) === 0) {
          const fixture = demoFixtureForQuestion(question);
          if (fixture) {
            ctx.waitUntil(writeAskCache(question, fixture, 86_400));
            return json(
              { ...fixture, engineNote: `${fixture.engineNote ?? "Earth Agent"} · fast-fallback` },
              200,
              { "X-Earth-Cache": "FIXTURE", "Cache-Control": "public, max-age=300" },
            );
          }
        }

        const worthCaching = (result.candidates?.length ?? 0) > 0
          || (result.answer.length > 80 && !/could not rank candidates|missing roads/i.test(result.answer));
        if (worthCaching) {
          const ttl = isWelcomeAskPrompt(question) ? 86_400 : 21_600;
          ctx.waitUntil(writeAskCache(question, result, ttl));
        }

        return json(result, 200, { "X-Earth-Cache": "MISS", "Cache-Control": "public, max-age=120" });
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
