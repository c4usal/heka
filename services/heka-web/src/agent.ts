import { createSession, executeTool, type ToolEnv, type AgentSession } from "./tools";
import type { EarthDiscovery, EarthDslStep, EarthResponse, EarthTraceStep } from "./types";
import { planEvidenceNeeds } from "./connectors";
import { expertSiteNarrative } from "./scorer";
import { formatSearchForPrompt, synthesizeFromSearch, webSearch, type WebSearchResult } from "./webSearch";

type ChatCompletion = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

type AgentPlan = {
  place: string;
  mode: "facility" | "bridge" | "inventory";
  themes: string[];
  themeLabel: string;
  weights: Record<string, number>;
  serviceRadiusMeters: number;
  placeDefaulted?: boolean;
};

type Intent = "chat" | "place_research" | "siting_facility" | "siting_bridge";

const FACILITY_THEMES: Array<{ match: RegExp; theme: string; label: string; radius: number }> = [
  { match: /\bfire\s*station\b|\bfirehall\b/, theme: "fire_station", label: "fire station", radius: 2500 },
  { match: /\bcharg|ev\s*station|electric\s*vehicle\b/, theme: "charging_station", label: "EV charger", radius: 1200 },
  { match: /\bpark\b|\bplayground\b/, theme: "park", label: "park", radius: 1500 },
  { match: /\bschool\b|\buniversity\b|\bcollege\b/, theme: "school", label: "school", radius: 2000 },
  { match: /\blibrary\b/, theme: "library", label: "library", radius: 2000 },
  { match: /\bclinic\b|\bdoctors?\b/, theme: "clinic", label: "clinic", radius: 2000 },
  { match: /\bhospital\b|\bmedical\s*centre\b|\ber\b/, theme: "hospital", label: "hospital", radius: 2500 },
];

function detectFacilityTheme(question: string): { theme: string; label: string; radius: number } | null {
  for (const row of FACILITY_THEMES) {
    if (row.match.test(question)) return { theme: row.theme, label: row.label, radius: row.radius };
  }
  return null;
}

function detectIntent(question: string): Intent {
  const q = question.toLowerCase().trim();
  if (/^(hi|hello|hey|thanks|thank you|yo)\b/.test(q) || q.length < 3) return "chat";
  if (/\bbridge|crossing|span the river\b/.test(q) && /\b(where|best|build|site|put)\b/.test(q)) return "siting_bridge";
  const facility = detectFacilityTheme(q);
  if (
    facility
    && /\b(where should|best location|underserved|build (a|the|another)|site (a|for|an?)|put (a|an|the|another)|place (a|the)|locate|where (to|do i) put)\b/.test(q)
  ) {
    return "siting_facility";
  }
  if (facility && /\b(where|best|should|recommend|site|build)\b/.test(q)) return "siting_facility";
  if (/\b(in|near|around|at)\s+[A-Z]/.test(question) || /\b(calgary|lagos|lethbridge|london|toronto|vancouver)\b/i.test(q)) {
    if (/\b(map|flood|road|dangerous|hazard|crime|safe|park|bridge|hospital)\b/.test(q)) return "place_research";
  }
  if (/\b(where|map|geospatial|gis|layer|dataset)\b/.test(q) && /\b[A-Z][a-z]+/.test(question)) return "place_research";
  return "chat";
}

function extractPlaceHint(question: string): string | null {
  const shouldBuild = question.match(/\bshould\s+([A-Z][A-Za-z.-]{2,40})\s+build\b/);
  if (shouldBuild?.[1]) return shouldBuild[1].trim();
  const inMatch = question.match(/\bin\s+([A-Z][A-Za-z\s.-]{1,40}?)(?:\s+considering|\s+to\b|\s+and\b|\?|,|$)/);
  if (inMatch?.[1]) return inMatch[1].trim();
  if (/lethbridge/i.test(question)) return "Lethbridge";
  if (/calgary/i.test(question)) return "Calgary";
  if (/edmonton/i.test(question)) return "Edmonton";
  if (/lagos/i.test(question)) return "Lagos";
  if (/london/i.test(question)) return "London";
  if (/toronto/i.test(question)) return "Toronto";
  if (/vancouver/i.test(question)) return "Vancouver";
  if (/ottawa/i.test(question)) return "Ottawa";
  if (/montreal|montréal/i.test(question)) return "Montreal";
  if (/winnipeg/i.test(question)) return "Winnipeg";
  return null;
}

function emptyResponse(partial: Partial<EarthResponse> & Pick<EarthResponse, "answer" | "trace">): EarthResponse {
  return {
    location: { name: "", lat: 0, lon: 0, bbox: [0, 0, 0, 0] },
    criteria: [],
    candidates: [],
    layers: [],
    assumptions: [],
    limitations: [],
    confidence: 70,
    next_actions: [],
    dsl: [],
    discovery: { need: [], found: [], missing: [] },
    runtime: "open-data-tools",
    engineNote: "Open web + Earth tools. GIS runs only when the question needs it.",
    ...partial,
  };
}

async function narrateWithLlm(
  env: ToolEnv,
  question: string,
  search: WebSearchResult,
  extraContext: string,
): Promise<string | null> {
  const gateway = env.AI_GATEWAY_URL.replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${gateway}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "earth-narrator",
        temperature: 0.3,
        stream: false,
        max_tokens: 500,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "earth_chat",
            schema: {
              type: "object",
              properties: { answer: { type: "string" } },
              required: ["answer"],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: "system",
            content: `You are Heka's Earth Agent — a precise spatial reasoning assistant.
Rules:
- Answer the question directly in natural prose. Do NOT dump numbered search-result lists.
- Cite sources by name only (e.g. "Wikipedia — Lethbridge", "World Population Review — …"). Never paste raw URLs.
- If BEST EXTRACT answers the question, lead with that synthesis.
- Never invent official flood maps, crime rankings, or census numbers absent from evidence.
- If GIS_RECOMMENDATION is provided, treat it as the expert recommendation and polish it conversationally — keep metrics and the coverage-vs-demand framing. Do not reduce the why to "arterial access" alone.
- Keep answers concise (short paragraphs). End with one optional next-step sentence when useful.`,
          },
          {
            role: "user",
            content: `Question: ${question}\n\nOPEN WEB RESULTS:\n${formatSearchForPrompt(search)}\n\nEXTRA CONTEXT:\n${extraContext || "(none)"}`,
          },
        ],
      }),
    });
    const payload = await response.json() as ChatCompletion;
    if (!response.ok) return null;
    const raw = payload.choices?.[0]?.message?.content ?? "";
    try {
      return (JSON.parse(raw) as { answer?: string }).answer?.trim() || null;
    } catch {
      return raw.trim() || null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function heuristicPlan(question: string, intent: Intent): AgentPlan {
  const hinted = extractPlaceHint(question);
  const place = hinted ?? "Calgary";
  const placeDefaulted = !hinted;

  if (intent === "siting_bridge") {
    return {
      place,
      mode: "bridge",
      themes: ["waterways", "bridges"],
      themeLabel: "bridge",
      weights: { river_proximity: 0.35, bridge_gap: 0.35, access: 0.2, demand: 0.1 },
      serviceRadiusMeters: 450,
    };
  }

  const facility = detectFacilityTheme(question);
  let themeLabel = facility?.label ?? "facility";
  let themes = facility ? [facility.theme] : [];
  let radius = facility?.radius ?? 2500;

  if (intent !== "siting_facility") {
    themeLabel = "open map";
    themes = [];
  }

  if (/flood|waterway|river|inundat/i.test(question) && !themes.includes("waterways")) {
    if (intent === "place_research") themes = ["waterways", ...themes];
  }

  const q = question.toLowerCase();
  const weights: Record<string, number> = {
    undersupply: 0.32,
    demand: /population|density|demand/.test(q) ? 0.3 : 0.26,
    activity: 0.14,
    access: 0.12,
    flood_risk: /flood|dangerous|hazard|water/.test(q) ? 0.16 : 0.08,
    growth_proxy: /growth|future/.test(q) ? 0.1 : 0.04,
    suitability: 0.04,
  };
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(weights)) weights[k] = Number((weights[k] / sum).toFixed(3));

  return {
    place,
    mode: intent === "siting_facility" ? "facility" : "inventory",
    themes,
    themeLabel,
    weights,
    serviceRadiusMeters: radius,
    placeDefaulted,
  };
}

function buildDiscovery(evidence: ReturnType<typeof planEvidenceNeeds>, session: AgentSession, search: WebSearchResult): EarthDiscovery {
  const need = [
    { id: "web", label: "open web research" },
    ...evidence.plan.map((p) => ({ id: p.evidence, label: p.evidence.replace(/_/g, " "), reason: p.reason })),
  ];
  const found = [
    ...search.hits.slice(0, 4).map((h, i) => ({
      id: `web-${i}`,
      label: h.title.slice(0, 48),
      connector: h.source,
      status: "available",
      featureCount: 1,
    })),
    ...session.layers.filter((l) => l.featureCount > 0).map((l) => ({
      id: l.id,
      label: l.name,
      connector: "openstreetmap",
      status: "available",
      featureCount: l.featureCount,
    })),
  ];
  const missing: EarthDiscovery["missing"] = [];
  for (const p of evidence.plan) {
    for (const c of p.connectors) {
      if (c.status === "unavailable" || c.status === "needs_key") {
        missing.push({ id: c.connectorId, label: c.connectorId.replace(/_/g, " "), status: c.status, reason: c.detail });
      }
    }
  }
  return { need, found, missing };
}

function buildDsl(plan: AgentPlan, session: AgentSession): EarthDslStep[] {
  const steps: EarthDslStep[] = [
    { id: "d1", operation: "WebSearch", label: "Open-web research", inputs: ["duckduckgo", "wikipedia"], rationale: "Primary evidence skill" },
  ];
  if (plan.mode === "inventory" && !session.lastCandidates?.length) {
    steps.push(
      { id: "d2", operation: "LoadDataset", label: `Geocode ${plan.place}`, inputs: ["nominatim"], rationale: "Place context" },
      { id: "d3", operation: "LoadDataset", label: "Open map layers", inputs: ["osm"], rationale: "Local geometry" },
      { id: "d4", operation: "Visualize", label: "MapProduct", inputs: ["layers"], rationale: "Show context" },
    );
    return steps;
  }
  steps.push(
    { id: "d2", operation: "LoadDataset", label: `Geocode ${plan.place}`, inputs: ["nominatim"], rationale: "BBox" },
    { id: "d3", operation: "LoadDataset", label: "Siting evidence bundle", inputs: ["osm"], rationale: "Roads + facilities + demand proxies" },
    { id: "d4", operation: "Score", label: "Multi-criteria score", inputs: Object.keys(plan.weights), rationale: "Deterministic" },
    { id: "d5", operation: "Rank", label: "Rank sites", inputs: ["Score"], rationale: "Candidates" },
    { id: "d6", operation: "Visualize", label: "MapProduct", inputs: ["Rank"], rationale: "Globe" },
  );
  return steps;
}

/**
 * Earth Agent — search-first, conversational, GIS when needed.
 * Facility siting uses one multi-criteria model for every amenity theme.
 */
export async function runEarthAgent(question: string, env: ToolEnv): Promise<EarthResponse> {
  const trace: EarthTraceStep[] = [];
  const intent = detectIntent(question);
  trace.push({ tool: "intent", summary: `Understood as ${intent.replace(/_/g, " ")}` });

  const qEarly = question.toLowerCase().trim();
  if (/^(hi|hello|hey|yo)\b/.test(qEarly)) {
    return emptyResponse({
      answer: "Hi — I’m Heka’s Earth Agent. Ask a place question, a factual one, or a siting ask (park, school, fire station, hospital, EV charger, bridge…).",
      confidence: 95,
      limitations: [],
      discovery: { need: [], found: [], missing: [] },
      next_actions: [
        { label: "Ask a siting question", action: "compare_candidates" },
        { label: "Research a city", action: "import_flood" },
      ],
      dsl: [{ id: "d1", operation: "Chat", label: "Greeting", inputs: [], rationale: "Short-circuit" }],
      trace,
      engineNote: "Greeting — no tools required.",
      runtime: "open-data-tools",
    });
  }

  // Siting path: skip open-web entirely (latency + off-topic snippets).
  const isSiting = intent === "siting_facility" || intent === "siting_bridge";

  if (intent === "chat") {
    const search = await webSearch(question, { includeGithub: false });
    trace.push({
      tool: "web_search",
      summary: search.hits.length
        ? `Open web: ${search.hits.length} hits`
        : "Open web: no hits (continuing with other evidence)",
    });

    const q = question.toLowerCase().trim();
    if (/^[a-z]{6,}$/i.test(q) && !/[aeiou]{2}/.test(q) && !/\b(the|and|what|where|how|why)\b/.test(q)) {
      return emptyResponse({
        answer: "I couldn’t make sense of that input. Try a clear question — e.g. “Where is Lethbridge?” or “Where should I put a park in Calgary?”",
        confidence: 30,
        limitations: ["Uninterpretable input."],
        discovery: { need: [], found: [], missing: [] },
        next_actions: [{ label: "Ask a siting question", action: "compare_candidates" }],
        dsl: [{ id: "d1", operation: "Chat", label: "Clarify", inputs: [], rationale: "Garbage input" }],
        trace,
        engineNote: "Rejected uninterpretable input.",
        runtime: "open-data-tools",
      });
    }
    if (/\bcanada\b/.test(q) && /\b(state|province|territor)/.test(q)) {
      return emptyResponse({
        answer: [
          "Canada doesn’t use states.",
          "It has **10 provinces** and **3 territories**.",
          "",
          "Provinces: Alberta, British Columbia, Manitoba, New Brunswick, Newfoundland and Labrador, Nova Scotia, Ontario, Prince Edward Island, Quebec, Saskatchewan.",
          "Territories: Northwest Territories, Nunavut, Yukon.",
          "",
          "Sources: Wikipedia — Provinces and territories of Canada.",
        ].join("\n"),
        confidence: 92,
        limitations: ["Factual geography answer — no MapProduct required."],
        discovery: {
          need: [{ id: "web", label: "open web" }],
          found: [{ id: "civics", label: "geography facts" }, ...search.hits.slice(0, 3).map((h, i) => ({ id: `w${i}`, label: h.title.slice(0, 40), connector: h.source }))],
          missing: [],
        },
        next_actions: [
          { label: "Ask a siting question", action: "compare_candidates" },
          { label: "Research a city", action: "import_flood" },
        ],
        dsl: [{ id: "d1", operation: "WebSearch", label: "Open-web research", inputs: ["duckduckgo"], rationale: "Primary skill" }],
        trace,
        engineNote: "Conversational path — web search first; GIS not required.",
        runtime: "open-data-tools",
      });
    }

    // Prefer deterministic synthesis when we already have a direct extract — skips LLM RTT.
    let answer: string;
    let narrated: string | null = null;
    if (search.directAnswer) {
      answer = synthesizeFromSearch(question, search);
    } else {
      narrated = await narrateWithLlm(
        env,
        question,
        search,
        search.hits.length
          ? "No GIS run — answer from open web + knowledge."
          : "Open-web search returned no hits. Answer from well-established general knowledge if the question is factual; say clearly when you are unsure. Do not invent GIS analysis.",
      );
      answer = narrated ?? synthesizeFromSearch(question, search);
    }
    return emptyResponse({
      answer,
      confidence: search.hits.length ? 80 : (narrated ? 62 : 40),
      limitations: search.hits.length
        ? ["Answered primarily from open-web research; no MapProduct for this turn."]
        : ["Open-web hits were empty; answer may rely on model knowledge — verify critical facts."],
      discovery: {
        need: [{ id: "web", label: "open web" }],
        found: search.hits.slice(0, 5).map((h, i) => ({ id: `w${i}`, label: h.title.slice(0, 40), connector: h.source })),
        missing: [],
      },
      next_actions: [
        { label: "Ask a siting question", action: "compare_candidates" },
        { label: "Research a city", action: "import_flood" },
      ],
      dsl: [{ id: "d1", operation: "WebSearch", label: "Open-web research", inputs: ["duckduckgo"], rationale: "Primary skill" }],
      trace,
      engineNote: "Conversational path — web search first; GIS not required.",
      runtime: "open-data-tools",
    });
  }

  const session = createSession();
  let runtime: EarthResponse["runtime"] = "open-data-tools";
  let engineNote = isSiting
    ? "Fast siting path — OSM multi-criteria score (no web digression)."
    : "Web search + open-data GIS tools (parallel). Desktop IDE can also run QGIS Processing.";

  // Run open-web and GIS in parallel for place research (siting skips web).
  const searchPromise: Promise<WebSearchResult> = isSiting
    ? Promise.resolve({ query: question, hits: [], summaryLines: [] })
    : webSearch(question, { includeGithub: false });

  try {
    const evidence = isSiting
      ? { plan: [] as ReturnType<typeof planEvidenceNeeds>["plan"] }
      : ((await executeTool("plan_evidence", { question }, session, env, trace)).result as ReturnType<typeof planEvidenceNeeds>);

    let plan = heuristicPlan(question, intent);
    if (!plan.place) plan = heuristicPlan(question, intent);
    trace.push({ tool: "earth_planner", summary: `Plan ${plan.mode} @ ${plan.place}; themes=${plan.themes.join(",") || "roads"}` });

    const gisWork = (async () => {
      await executeTool("geocode_place", { query: plan.place }, session, env, trace);

      if (plan.mode === "facility" && plan.themes[0]) {
        await executeTool("load_siting_bundle", { amenity: plan.themes[0] }, session, env, trace);
        const notes: string[] = [];
        if (session.buildings.length) notes.push(`Next: refine with denser building samples (${session.buildings.length} loaded).`);
        if (session.communityAnchors.length) notes.push(`Next: enrich activity anchors (${session.communityAnchors.length} loaded).`);
        if (!session.buildings.length) notes.push("Next: densify OSM buildings / census for demand.");
        session.demandNotes = notes;
        trace.push({ tool: "sample_demand", summary: notes[0] ?? "Demand proxies from bundle" });
      } else if (plan.mode === "bridge") {
        await Promise.all([
          executeTool("osm_features", { theme: "roads", layerName: "Arterial roads" }, session, env, trace),
          executeTool("osm_features", { theme: "waterways", layerName: "Waterways" }, session, env, trace),
          executeTool("osm_features", { theme: "bridges", layerName: "Bridges" }, session, env, trace),
        ]);
      } else {
        await executeTool("osm_features", { theme: "roads", layerName: "Arterial roads" }, session, env, trace);
        const extras = plan.themes.filter((t) => t !== "roads").slice(0, 1);
        for (const theme of extras) {
          await executeTool("osm_features", { theme, layerName: theme.replace(/_/g, " ") }, session, env, trace);
        }
      }

      const canScore = (plan.mode === "facility" && session.roads.length)
        || (plan.mode === "bridge" && session.waterways.length && session.roads.length);
      if (canScore) {
        await executeTool("score_sites", {
          mode: plan.mode === "bridge" ? "bridge" : "facility",
          themeLabel: plan.themeLabel,
          topN: 5,
          serviceRadiusMeters: plan.serviceRadiusMeters,
          weights: plan.weights,
        }, session, env, trace);
      } else {
        trace.push({ tool: "score_sites", summary: "Skipped ranking — research/inventory mode or missing layers" });
      }
      await executeTool("emit_map_layers", {}, session, env, trace);
    })();

    const [search] = await Promise.all([searchPromise, gisWork]);
    if (!isSiting) {
      trace.push({
        tool: "web_search",
        summary: search.hits.length
          ? `Open web: ${search.hits.length} hits`
          : "Open web: no hits (continuing with other evidence)",
      });
    } else {
      trace.push({ tool: "web_search", summary: "Skipped — siting uses open-map evidence only" });
    }

    const placeName = session.place?.displayName ?? plan.place;
    const top = session.lastCandidates?.[0];
    const placeNote = plan.placeDefaulted
      ? `Note: no city was specified — used ${plan.place} as a default demo place. Ask again with an explicit city for a better run.`
      : "";

    let answer: string;
    if (top) {
      answer = expertSiteNarrative({
        placeName,
        themeLabel: plan.themeLabel,
        candidate: top,
        weights: plan.weights,
        facilityCount: session.facilities.length,
        serviceRadiusMeters: plan.serviceRadiusMeters,
      });
      if (placeNote) answer = `${answer}\n\n${placeNote}`;
    } else {
      let gisBlurb = `Mapped ${session.layers.length} open layers around ${placeName}.`;
      if (session.layers.length) {
        gisBlurb = `Mapped open layers around ${placeName}: ${session.layers.map((l) => `${l.name} (${l.featureCount})`).join(", ")}. ${placeNote}`;
      }
      if (isSiting) {
        answer = [
          `I mapped open layers around ${placeName} but could not rank candidates this turn (missing roads or facilities).`,
          "",
          "Try again in a moment, or ask with a clearer city name.",
        ].join("\n");
      } else if (search.directAnswer) {
        answer = [
          synthesizeFromSearch(question, search),
          "",
          session.layers.length
            ? `Also mapped: ${session.layers.map((l) => `${l.name} (${l.featureCount})`).join(", ")}.`
            : "",
        ].filter(Boolean).join("\n");
      } else {
        const narrated = await narrateWithLlm(
          env,
          question,
          search,
          `${gisBlurb}\nNext direction: ${(session.lastLimitations ?? []).slice(0, 3).join("; ")}\nPlace: ${placeName}`,
        );
        if (narrated) {
          answer = narrated;
        } else if (intent === "place_research" && /dangerous|crime|hazard/i.test(question)) {
          answer = [
            search.directAnswer || search.hits[0]?.snippet || `I researched “${question}” on the open web.`,
            "",
            `I mapped available open layers around ${placeName}, but I won’t invent a single “most dangerous” pin — official crime/flood scores aren’t in this connector set.`,
            "",
            "Ask a concrete siting question if you want ranked candidates.",
          ].join("\n");
        } else if (session.layers.length) {
          answer = [
            `Here’s an open-map view of ${placeName}.`,
            "",
            `Loaded: ${session.layers.map((l) => `${l.name} (${l.featureCount})`).join(", ")}.`,
            "",
            search.directAnswer || "Ask a concrete siting question (park, school, fire station, hospital, EV charger, bridge…) for ranked candidates.",
          ].join("\n");
        } else {
          answer = [
            `I looked this up on the open web around ${placeName}.`,
            "",
            search.directAnswer || search.hits[0]?.snippet || "",
            "",
            "Ask a concrete siting question if you want ranked candidates.",
          ].filter(Boolean).join("\n");
        }
      }
    }

    const finalized = await executeTool("finalize_answer", {
      answer,
      assumptions: [
        isSiting
          ? "Siting ranks open-map evidence only (OSM) — no web digression."
          : "Open-web search is the primary evidence skill for non-siting questions.",
        "Facility siting uses one multi-criteria model for every amenity type.",
      ],
      limitations: [
        ...(session.lastLimitations ?? []).map((l) => (l.startsWith("Next") ? l : `Next: ${l}`)),
        ...session.demandNotes
          .filter((n) => /Next:|proxy|thin|densif/i.test(n))
          .map((n) => (n.startsWith("Next") ? n : `Next: ${n}`)),
      ].slice(0, 4),
      confidence: Math.min(88, (session.lastConfidence ?? 50) + (session.buildings.length ? 6 : 0) + (session.facilities.length ? 4 : 0)),
      next_actions: top
        ? [
            { label: "Explain scoring", action: "explain_scoring" },
            { label: "Compare top candidates", action: "compare_candidates" },
            { label: "Search related open data", action: "import_flood" },
            { label: "Export GeoJSON", action: "export_geojson" },
          ]
        : [
            { label: "Ask a siting question", action: "compare_candidates" },
            { label: "Export GeoJSON", action: "export_geojson" },
          ],
    }, session, env, trace);

    const base = finalized.finalized!;
    return {
      answer: base.answer!,
      location: base.location!,
      criteria: base.criteria ?? [],
      candidates: base.candidates ?? [],
      layers: base.layers ?? session.layers,
      assumptions: base.assumptions ?? [],
      limitations: base.limitations ?? [],
      confidence: base.confidence ?? 60,
      trace,
      next_actions: base.next_actions ?? [],
      dsl: buildDsl(plan, session),
      discovery: buildDiscovery(evidence as ReturnType<typeof planEvidenceNeeds>, session, search),
      runtime,
      engineNote,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    trace.push({ tool: "runtime", summary: message });
    if (isSiting) {
      return emptyResponse({
        answer: `Siting hit a data timeout (${message}). Try the same ask again — repeats are cached and usually much faster.`,
        confidence: 35,
        limitations: [`Next: retry — open-map mirrors were slow (${message}).`],
        discovery: { need: [], found: [], missing: [{ id: "gis", label: "gis pipeline", reason: message }] },
        trace,
        runtime: "open-data-tools-fallback",
        engineNote: "Fast siting path failed on open-map fetch.",
      });
    }
    const search = await searchPromise.catch(() => ({ query: question, hits: [], summaryLines: [] } as WebSearchResult));
    const narrated = search.directAnswer
      ? null
      : await narrateWithLlm(env, question, search, `GIS path failed: ${message}. Answer from web.`);
    return emptyResponse({
      answer: narrated ?? synthesizeFromSearch(question, search),
      confidence: 40,
      limitations: [message],
      discovery: {
        need: [{ id: "web", label: "open web" }],
        found: search.hits.slice(0, 3).map((h, i) => ({ id: `w${i}`, label: h.title.slice(0, 40) })),
        missing: [{ id: "gis", label: "gis pipeline", reason: message }],
      },
      trace,
      runtime: "open-data-tools-fallback",
      engineNote: "Fell back to open-web answer after a GIS step failed.",
    });
  }
}
