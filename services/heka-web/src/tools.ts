import { geocodeScope, fetchOsmTheme, fetchFacilitySitingBundle, type PlaceFocus, type OsmFeature } from "./osm";
import { scoreSites, type ScoreSitesInput } from "./scorer";
import { planEvidenceNeeds } from "./connectors";
import { webSearch } from "./webSearch";
import type { EarthLayer, EarthNextAction, EarthResponse, EarthTraceStep, GeoFeature } from "./types";

export type ToolEnv = {
  AI_GATEWAY_URL: string;
  WORLDPOP_API_KEY?: string;
  ORS_API_KEY?: string;
  EARTH_CACHE?: KVNamespace;
};

export type AgentSession = {
  place?: PlaceFocus;
  layers: EarthLayer[];
  roads: GeoFeature[];
  facilities: GeoFeature[];
  waterways: GeoFeature[];
  bridges: GeoFeature[];
  buildings: GeoFeature[];
  landuse: GeoFeature[];
  communityAnchors: GeoFeature[];
  research: string[];
  lastScoreSummary?: string;
  lastCandidates?: EarthResponse["candidates"];
  lastCriteria?: EarthResponse["criteria"];
  lastLimitations?: string[];
  lastConfidence?: number;
  demandNotes: string[];
  accessNotes: string[];
};

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "PRIMARY skill: search the open web (DuckDuckGo + Wikipedia + GitHub). Use for any question before inventing answers. Prefer this over forcing GIS.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          includeGithub: { type: "boolean" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_evidence",
      description: "Decide what spatial evidence is needed and which connectors can supply it. Use after web_search when the question is geospatial.",
      parameters: {
        type: "object",
        properties: { question: { type: "string", description: "The user question to analyze for evidence needs" } },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "geocode_place",
      description: "Resolve a place name to coordinates and a working bbox once you know a location is needed.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "City, region, or place name" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "osm_features",
      description: "Fetch OpenStreetMap features via the openstreetmap connector. Themes: roads, waterways, bridges, buildings, landuse, hospital, fire_station, park, charging_station, school, transit, or any OSM amenity name.",
      parameters: {
        type: "object",
        properties: {
          theme: { type: "string" },
          layerName: { type: "string", description: "Optional display name for the map layer" },
        },
        required: ["theme"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_place",
      description: "Open-research connector: DuckDuckGo Instant Answer + Wikipedia. Use for context, history, and when official geospatial connectors are unavailable.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sample_demand",
      description: "Demand connector: OSM building-density proxy, plus WorldPop when WORLDPOP_API_KEY is set. Never claim census accuracy without WorldPop.",
      parameters: {
        type: "object",
        properties: { note: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "route_access",
      description: "Accessibility connector: OpenRouteService drive-time when ORS_API_KEY is set; otherwise arterial-class proxy only.",
      parameters: {
        type: "object",
        properties: {
          lon: { type: "number" },
          lat: { type: "number" },
          rangeSeconds: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "score_sites",
      description: "Deterministic multi-criteria ranking from loaded evidence. Model chooses weights; tool computes. mode=facility for hospitals/parks/chargers/fire; mode=bridge for crossings.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["facility", "bridge"] },
          themeLabel: { type: "string" },
          topN: { type: "number" },
          serviceRadiusMeters: { type: "number" },
          weights: {
            type: "object",
            properties: {
              undersupply: { type: "number" },
              demand: { type: "number" },
              access: { type: "number" },
              flood_risk: { type: "number" },
              growth_proxy: { type: "number" },
              suitability: { type: "number" },
              river_proximity: { type: "number" },
              bridge_gap: { type: "number" },
            },
          },
        },
        required: ["mode"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "emit_map_layers",
      description: "Confirm map packaging for Cesium. Call before finalize.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "finalize_answer",
      description: "Submit the final EarthResponse. Candidates must come from score_sites when siting. Always include honest limitations and next_actions.",
      parameters: {
        type: "object",
        properties: {
          answer: { type: "string" },
          assumptions: { type: "array", items: { type: "string" } },
          limitations: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          next_actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                action: { type: "string" },
              },
              required: ["label", "action"],
            },
          },
        },
        required: ["answer"],
      },
    },
  },
] as const;

function layerKindForTheme(theme: string): EarthLayer["kind"] {
  const t = theme.toLowerCase();
  if (/road|arterial/.test(t)) return "roads";
  if (/water|river/.test(t)) return "waterways";
  if (/bridge/.test(t)) return "bridges";
  if (/hospital|fire|school|park|charg|transit|amenity/.test(t)) return "stations";
  return "generic";
}

function storeThemeFeatures(session: AgentSession, theme: string, features: OsmFeature[]) {
  const t = theme.toLowerCase();
  if (/road|arterial/.test(t)) session.roads = features;
  else if (/water|river/.test(t)) session.waterways = features;
  else if (/bridge/.test(t)) session.bridges = features;
  else if (/building/.test(t)) session.buildings = features;
  else if (/landuse/.test(t)) session.landuse = features;
  else if (/community|activity_anchor/.test(t)) session.communityAnchors = features;
  else session.facilities = features;
}

const bundleMemory = new Map<string, { expires: number; value: unknown }>();

function earthDataRequest(key: string): Request {
  return new Request(`https://heka-earth-data.internal/v1?k=${encodeURIComponent(key)}`, { method: "GET" });
}

async function cachedFetchJson(env: ToolEnv, key: string, loader: () => Promise<unknown>, ttlSeconds = 3600): Promise<unknown> {
  const mem = bundleMemory.get(key);
  if (mem && mem.expires > Date.now()) return mem.value;

  try {
    const hit = await caches.default.match(earthDataRequest(key));
    if (hit) {
      const value = await hit.json();
      bundleMemory.set(key, { expires: Date.now() + ttlSeconds * 1000, value });
      return value;
    }
  } catch {
    /* Cache API best-effort */
  }

  if (env.EARTH_CACHE) {
    const hit = await env.EARTH_CACHE.get(key, "json");
    if (hit) {
      bundleMemory.set(key, { expires: Date.now() + ttlSeconds * 1000, value: hit });
      return hit;
    }
  }

  const value = await loader();
  const isEmptyBundle = typeof value === "object" && value != null
    && "roads" in value
    && Array.isArray((value as { roads?: unknown[] }).roads)
    && (value as { roads: unknown[] }).roads.length === 0;
  if (!isEmptyBundle) {
    bundleMemory.set(key, { expires: Date.now() + ttlSeconds * 1000, value });
    try {
      await caches.default.put(
        earthDataRequest(key),
        new Response(JSON.stringify(value), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${ttlSeconds}`,
          },
        }),
      );
    } catch {
      /* ignore */
    }
    if (env.EARTH_CACHE) {
      void env.EARTH_CACHE.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
    }
  }
  return value;
}

export async function gatherResearch(query: string): Promise<string[]> {
  const snippets: string[] = [];
  const withTimeout = async (url: string, ms = 5000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { headers: { "User-Agent": "Heka Earth Agent/0.1" }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const ddg = await withTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(query.slice(0, 240))}&format=json&no_html=1&skip_disambig=1`);
    if (ddg.ok) {
      const payload = await ddg.json() as { AbstractText?: string; Heading?: string; RelatedTopics?: Array<{ Text?: string }> };
      if (payload.AbstractText) snippets.push(`${payload.Heading ? `${payload.Heading}: ` : ""}${payload.AbstractText}`);
      for (const topic of (payload.RelatedTopics ?? []).slice(0, 3)) if (topic.Text) snippets.push(topic.Text);
    }
  } catch { /* best effort */ }
  try {
    const search = await withTimeout(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=2&namespace=0&format=json`);
    if (search.ok) {
      const payload = await search.json() as [string, string[], string[], string[]];
      for (const title of (payload[1] ?? []).slice(0, 1)) {
        const summary = await withTimeout(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, 4000);
        if (!summary.ok) continue;
        const page = await summary.json() as { extract?: string; title?: string };
        if (page.extract) snippets.push(`Wikipedia (${page.title ?? title}): ${page.extract.slice(0, 400)}`);
      }
    }
  } catch { /* best effort */ }
  return snippets;
}

async function sampleWorldPop(env: ToolEnv, place: PlaceFocus): Promise<string | null> {
  if (!env.WORLDPOP_API_KEY) return null;
  try {
    const geojson = encodeURIComponent(JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[
            [place.west, place.south],
            [place.east, place.south],
            [place.east, place.north],
            [place.west, place.north],
            [place.west, place.south],
          ]],
        },
      }],
    }));
    const url = `https://api.worldpop.org/v1/services/stats?dataset=wpgppop&year=2020&geojson=${geojson}&key=${encodeURIComponent(env.WORLDPOP_API_KEY)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { total_population?: number }; status?: string; taskid?: string };
    if (payload.data?.total_population != null) {
      return `WorldPop 2020 total population in working bbox ≈ ${Math.round(payload.data.total_population).toLocaleString()}.`;
    }
    // async task style
    if (payload.taskid) {
      return `WorldPop task queued (${payload.taskid}); using OSM building proxy for site ranking this round.`;
    }
  } catch {
    return null;
  }
  return null;
}

async function orsIsochrone(env: ToolEnv, lon: number, lat: number, rangeSeconds: number): Promise<string> {
  if (!env.ORS_API_KEY) {
    return "OpenRouteService key not configured — accessibility remains OSM arterial-class proxy only.";
  }
  try {
    const response = await fetch("https://api.openrouteservice.org/v2/isochrones/driving-car", {
      method: "POST",
      headers: {
        Authorization: env.ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locations: [[lon, lat]],
        range: [rangeSeconds],
        attributes: ["total_pop"],
      }),
    });
    if (!response.ok) return `ORS isochrone failed (${response.status}); falling back to arterial proxy.`;
    const payload = await response.json() as { features?: Array<{ properties?: { value?: number; total_pop?: number } }> };
    const feature = payload.features?.[0];
    return `ORS ${rangeSeconds}s drive-time isochrone ready (value=${feature?.properties?.value ?? rangeSeconds}, total_pop attr=${feature?.properties?.total_pop ?? "n/a"}).`;
  } catch (error) {
    return `ORS unavailable (${error instanceof Error ? error.message : "error"}); arterial proxy only.`;
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  session: AgentSession,
  env: ToolEnv,
  trace: EarthTraceStep[],
): Promise<{ result: unknown; finalized?: Partial<EarthResponse> }> {
  if (name === "web_search") {
    const query = String(args.query ?? "").trim();
    const includeGithub = Boolean(args.includeGithub);
    const result = await webSearch(query, { includeGithub });
    trace.push({ tool: name, summary: `Web search: ${result.hits.length} hits for “${query.slice(0, 60)}”` });
    return { result };
  }

  if (name === "plan_evidence") {
    const question = String(args.question ?? "").trim();
    const plan = planEvidenceNeeds(question, env);
    const summary = `Evidence plan: ${plan.plan.map((p) => p.evidence).join(", ")}`;
    trace.push({ tool: name, summary });
    return { result: plan };
  }

  if (name === "geocode_place") {
    const query = String(args.query ?? "").trim();
    const cacheKey = `geocode:${query.toLowerCase()}`;
    const place = await cachedFetchJson(env, cacheKey, () => geocodeScope(query)) as PlaceFocus;
    session.place = place;
    const summary = `Geocoded ${place.displayName}`;
    trace.push({ tool: name, summary });
    return { result: { displayName: place.displayName, lat: place.lat, lon: place.lon, south: place.south, north: place.north, west: place.west, east: place.east } };
  }

  if (name === "osm_features") {
    if (!session.place) throw new Error("Call geocode_place first.");
    const theme = String(args.theme ?? "roads").trim();
    const layerName = String(args.layerName ?? theme);
    const cacheKey = `osm:${session.place.lat.toFixed(3)}:${session.place.lon.toFixed(3)}:${theme}`;
    const fetched = await cachedFetchJson(env, cacheKey, () => fetchOsmTheme(session.place!, theme)) as Awaited<ReturnType<typeof fetchOsmTheme>>;
    storeThemeFeatures(session, theme, fetched.features);
    const kind = layerKindForTheme(theme);
    const layer: EarthLayer = {
      id: `osm-${theme}-${session.layers.length}`,
      name: layerName,
      kind,
      geojson: fetched.geojson,
      featureCount: fetched.featureCount,
    };
    session.layers = [...session.layers.filter((l) => l.name !== layerName), layer];
    const summary = `OSM ${theme}: ${fetched.featureCount} features`;
    trace.push({ tool: name, summary });
    return { result: { theme, featureCount: fetched.featureCount, layerId: layer.id } };
  }

  if (name === "research_place") {
    const query = String(args.query ?? "").trim();
    const snippets = await gatherResearch(query);
    session.research.push(...snippets);
    const summary = `Research: ${snippets.length} snippets`;
    trace.push({ tool: name, summary });
    return { result: { snippets } };
  }

  if (name === "sample_demand") {
    if (!session.place) throw new Error("Call geocode_place first.");
    const notes: string[] = [];
    if (session.buildings.length) {
      notes.push(`OSM building centres in session: ${session.buildings.length} (relative demand proxy).`);
    }
    if (session.communityAnchors.length) {
      notes.push(`Community activity anchors: ${session.communityAnchors.length} (schools/shops/services).`);
    }
    if (!session.buildings.length && !session.communityAnchors.length) {
      notes.push("Demand proxies thin this run — ranking leans on coverage gap + arterials.");
    }
    const worldpop = null as string | null; // skip remote WorldPop on the hot path (too slow for web demo)
    if (worldpop) notes.push(worldpop);
    else notes.push("Next: wire WorldPop / census grids for stronger demand scoring.");
    session.demandNotes = notes;
    trace.push({ tool: name, summary: notes[0] });
    return { result: { notes } };
  }

  if (name === "load_siting_bundle") {
    if (!session.place) throw new Error("Call geocode_place first.");
    const amenity = String(args.amenity ?? args.theme ?? "hospital").trim();
    const cacheKey = `siting-bundle:${session.place.lat.toFixed(3)}:${session.place.lon.toFixed(3)}:${amenity}`;
    const bundle = await cachedFetchJson(
      env,
      cacheKey,
      () => fetchFacilitySitingBundle(session.place!, amenity),
      21_600,
    ) as Awaited<ReturnType<typeof fetchFacilitySitingBundle>>;

    session.roads = bundle.roads;
    session.facilities = bundle.facilities;
    session.buildings = bundle.buildings;
    session.communityAnchors = bundle.communityAnchors;
    session.landuse = bundle.landuse;
    session.waterways = bundle.waterways;

    const pushLayer = (id: string, name: string, kind: EarthLayer["kind"], features: OsmFeature[]) => {
      if (!features.length) return;
      const layer: EarthLayer = {
        id,
        name,
        kind,
        geojson: JSON.stringify({ type: "FeatureCollection", features }),
        featureCount: features.length,
      };
      session.layers = [...session.layers.filter((l) => l.id !== id), layer];
    };
    pushLayer("osm-roads", "Arterial roads", "roads", bundle.roads);
    pushLayer("osm-facilities", amenity.replace(/_/g, " "), "stations", bundle.facilities);
    pushLayer("osm-buildings", "Buildings (sample)", "generic", bundle.buildings.slice(0, 200));
    pushLayer("osm-activity", "Community activity", "generic", bundle.communityAnchors);
    if (bundle.waterways.length) pushLayer("osm-waterways", "Waterways", "waterways", bundle.waterways);

    const summary = `Siting bundle (${amenity}): roads=${bundle.roads.length}, facilities=${bundle.facilities.length}, buildings=${bundle.buildings.length}, activity=${bundle.communityAnchors.length}`;
    trace.push({ tool: name, summary });
    return {
      result: {
        amenity,
        roads: bundle.roads.length,
        facilities: bundle.facilities.length,
        buildings: bundle.buildings.length,
        communityAnchors: bundle.communityAnchors.length,
        landuse: bundle.landuse.length,
        waterways: bundle.waterways.length,
      },
    };
  }

  if (name === "route_access") {
    if (!session.place) throw new Error("Call geocode_place first.");
    const lon = Number(args.lon ?? session.place.lon);
    const lat = Number(args.lat ?? session.place.lat);
    const rangeSeconds = Number(args.rangeSeconds ?? 900);
    const note = await orsIsochrone(env, lon, lat, rangeSeconds);
    session.accessNotes.push(note);
    trace.push({ tool: name, summary: note.slice(0, 120) });
    return { result: { note } };
  }

  if (name === "score_sites") {
    if (!session.roads.length) throw new Error("Load roads via osm_features before score_sites.");
    const mode = String(args.mode ?? "facility") === "bridge" ? "bridge" : "facility";
    // Zero existing facilities is valid (greenfield) — undersupply becomes uniform / high.
    if (mode === "bridge" && !session.waterways.length) throw new Error("Load waterways before bridge score_sites.");
    const input: ScoreSitesInput = {
      mode,
      roads: session.roads,
      facilities: session.facilities,
      waterways: session.waterways,
      bridges: session.bridges,
      buildings: session.buildings,
      landuse: session.landuse,
      communityAnchors: session.communityAnchors,
      weights: (args.weights as ScoreSitesInput["weights"]) ?? undefined,
      topN: Number(args.topN ?? 5),
      serviceRadiusMeters: Number(args.serviceRadiusMeters ?? (mode === "bridge" ? 450 : 2500)),
      themeLabel: String(args.themeLabel ?? (mode === "bridge" ? "bridge" : "facility")),
    };
    const scored = scoreSites(input);
    session.lastScoreSummary = scored.summary;
    session.lastCandidates = scored.candidates;
    session.lastCriteria = scored.criteria;
    session.lastLimitations = scored.limitations;
    session.lastConfidence = scored.confidence;
    for (const layer of scored.layers) {
      session.layers = [...session.layers.filter((l) => l.id !== layer.id), layer];
    }
    trace.push({ tool: name, summary: scored.summary });
    return {
      result: {
        summary: scored.summary,
        criteria: scored.criteria,
        candidates: scored.candidates,
        limitations: scored.limitations,
        confidence: scored.confidence,
      },
    };
  }

  if (name === "emit_map_layers") {
    const summary = `Map layers ready: ${session.layers.length}`;
    trace.push({ tool: name, summary });
    return {
      result: {
        layerCount: session.layers.length,
        layers: session.layers.map((l) => ({ id: l.id, name: l.name, kind: l.kind, featureCount: l.featureCount })),
      },
    };
  }

  if (name === "finalize_answer") {
    if (!session.place) throw new Error("Cannot finalize without geocode_place.");
    const answer = String(args.answer ?? "").trim();
    const assumptions = Array.isArray(args.assumptions) ? args.assumptions.map(String) : [];
    const limitations = [
      ...(Array.isArray(args.limitations) ? args.limitations.map(String) : []),
      ...(session.lastLimitations ?? []),
      ...session.demandNotes.filter((n) => /proxy|not configured/i.test(n)),
    ];
    const next_actions: EarthNextAction[] = Array.isArray(args.next_actions)
      ? (args.next_actions as Array<{ label?: string; action?: string }>)
          .filter((a) => a?.label && a?.action)
          .map((a) => ({ label: String(a.label), action: String(a.action) }))
      : defaultNextActions(session);
    const confidence = Number(args.confidence ?? session.lastConfidence ?? 55);
    trace.push({ tool: name, summary: "Final answer submitted" });
    return {
      result: { ok: true },
      finalized: {
        answer,
        location: {
          name: session.place.displayName,
          lat: session.place.lat,
          lon: session.place.lon,
          bbox: [session.place.west, session.place.south, session.place.east, session.place.north],
        },
        criteria: session.lastCriteria ?? [],
        candidates: session.lastCandidates ?? [],
        layers: session.layers,
        assumptions,
        limitations: [...new Set(limitations)],
        confidence: Math.max(0, Math.min(100, confidence)),
        next_actions,
        trace,
      },
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function defaultNextActions(session: AgentSession): EarthNextAction[] {
  const actions: EarthNextAction[] = [
    { label: "Explain scoring", action: "explain_scoring" },
    { label: "Export GeoJSON", action: "export_geojson" },
  ];
  if (session.lastCandidates?.length) {
    actions.unshift({ label: "Compare top candidates", action: "compare_candidates" });
  }
  if (!session.accessNotes.some((n) => /ORS \d+s/.test(n))) {
    actions.push({ label: "Run road-time analysis", action: "route_access" });
  }
  actions.push({ label: "Import flood dataset", action: "import_flood" });
  return actions.slice(0, 5);
}

export function createSession(): AgentSession {
  return {
    layers: [],
    roads: [],
    facilities: [],
    waterways: [],
    bridges: [],
    buildings: [],
    landuse: [],
    communityAnchors: [],
    research: [],
    demandNotes: [],
    accessNotes: [],
  };
}
