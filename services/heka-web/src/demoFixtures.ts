import type { EarthResponse } from "./types";
import { askCacheKey } from "./askCache";

/**
 * Instant demo fixtures for the Try-asking prompts.
 * Used when live Overpass is cold/slow — map + ranking still work in <1s.
 */
function candidateLayer(candidates: Array<{ rank: number; lon: number; lat: number; score: number; rationale: string }>): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: candidates.map((c) => ({
      type: "Feature",
      properties: {
        rank: c.rank,
        score: c.score,
        label: `#${c.rank}`,
        name: c.rank === 1 ? `#1 TOP` : `#${c.rank}`,
        rationale: c.rationale,
        isTopPick: c.rank === 1,
        pinSize: c.rank === 1 ? 34 : 22,
      },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  });
}

function coverageLayer(centers: Array<[number, number]>, radiusMeters: number): string {
  // Approximate rings as 16-point polygons.
  const ring = (lon: number, lat: number) => {
    const coords: number[][] = [];
    const dLat = radiusMeters / 111_320;
    const dLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
    for (let i = 0; i <= 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
    }
    return coords;
  };
  return JSON.stringify({
    type: "FeatureCollection",
    features: centers.map(([lon, lat], i) => ({
      type: "Feature",
      properties: { name: "coverage", facilityIndex: i + 1, radiusMeters },
      geometry: { type: "Polygon", coordinates: [ring(lon, lat)] },
    })),
  });
}

function baseFixture(partial: Partial<EarthResponse> & Pick<EarthResponse, "answer" | "location" | "candidates" | "layers">): EarthResponse {
  return {
    criteria: [
      { id: "undersupply", label: "undersupply", weight: 0.32, source: "distance to existing facilities" },
      { id: "demand", label: "demand", weight: 0.26, source: "OSM building density proxy" },
      { id: "activity", label: "activity", weight: 0.14, source: "OSM community activity anchors" },
      { id: "access", label: "access", weight: 0.12, source: "OSM arterial class" },
      { id: "flood_risk", label: "flood risk", weight: 0.08, source: "waterway proximity proxy" },
      { id: "growth_proxy", label: "growth proxy", weight: 0.04, source: "OSM open map" },
      { id: "suitability", label: "suitability", weight: 0.04, source: "OSM open map" },
    ],
    assumptions: ["Fast demo fixture — open-map multi-criteria sketch for Try asking."],
    limitations: [
      "Next: refresh with a live Overpass pull for the latest OSM inventory.",
      "Next: add census / drive-time layers for stronger demand and access.",
    ],
    confidence: 82,
    trace: [
      { tool: "intent", summary: "Understood as siting facility" },
      { tool: "cache", summary: "Served fast demo fixture (<1s)" },
    ],
    next_actions: [
      { label: "Explain scoring", action: "explain_scoring" },
      { label: "Compare top candidates", action: "compare_candidates" },
      { label: "Export GeoJSON", action: "export_geojson" },
    ],
    dsl: [
      { id: "d1", operation: "LoadDataset", label: "Open map evidence", inputs: ["osm"], rationale: "Fast path" },
      { id: "d2", operation: "Score", label: "Multi-criteria score", inputs: ["undersupply", "demand", "access"], rationale: "Deterministic" },
      { id: "d3", operation: "Visualize", label: "MapProduct", inputs: ["Score"], rationale: "Globe" },
    ],
    discovery: { need: [{ id: "osm", label: "openstreetmap" }], found: [{ id: "fixture", label: "demo open-map snapshot" }], missing: [] },
    runtime: "open-data-tools",
    engineNote: "Fast siting path — cached demo snapshot while live OSM warms.",
    ...partial,
  };
}

const calgaryHospitalCandidates = [
  { rank: 1, lon: -113.99582, lat: 50.95105, score: 0.86, rationale: "closes a larger gap in current hospital coverage; sits nearer denser built fabric" },
  { rank: 2, lon: -114.02110, lat: 50.96840, score: 0.81, rationale: "strong coverage gap; solid arterial access" },
  { rank: 3, lon: -113.96820, lat: 50.93980, score: 0.78, rationale: "balanced demand and access" },
  { rank: 4, lon: -114.04850, lat: 50.99210, score: 0.74, rationale: "growth-edge catchment" },
  { rank: 5, lon: -113.94200, lat: 50.97450, score: 0.71, rationale: "activity anchors nearby" },
];

const lagosBridgeCandidates = [
  { rank: 1, lon: 3.39410, lat: 6.46520, score: 0.84, rationale: "farther from existing bridges; closer to the water crossing" },
  { rank: 2, lon: 3.37880, lat: 6.45210, score: 0.79, rationale: "strong bridge gap; arterial access" },
  { rank: 3, lon: 3.41020, lat: 6.47150, score: 0.75, rationale: "balanced river proximity and demand" },
  { rank: 4, lon: 3.36150, lat: 6.44880, score: 0.72, rationale: "access-led alternative" },
  { rank: 5, lon: 3.42500, lat: 6.45890, score: 0.69, rationale: "secondary crossing option" },
];

const vancouverEvCandidates = [
  { rank: 1, lon: -123.12070, lat: 49.28270, score: 0.83, rationale: "higher estimated local demand; community activity nearby" },
  { rank: 2, lon: -123.10020, lat: 49.26340, score: 0.79, rationale: "demand and arterial access" },
  { rank: 3, lon: -123.13880, lat: 49.26810, score: 0.76, rationale: "activity anchors; suitability" },
  { rank: 4, lon: -123.08550, lat: 49.27590, score: 0.72, rationale: "coverage gap on the fringe" },
  { rank: 5, lon: -123.14920, lat: 49.25180, score: 0.69, rationale: "growth-edge demand" },
];

const FIXTURES: Record<string, EarthResponse> = {
  "siting:hospital:calgary": baseFixture({
    answer: [
      "For Calgary, Alberta, Canada, the #1 contender for a new hospital is at 50.95105, -113.99582.",
      "",
      "This site closes a meaningful gap in current hospital coverage (~8.4 km from the nearest mapped facility) while remaining on accessible arterials and serving areas with higher estimated demand.",
      "",
      "Based on available open datasets (mapped hospitals in the working area; building and community-activity demand proxies; 2.5 km straight-line service rings), it ranks highest on unmet coverage vs catchment need — not merely because a road is nearby.",
      "",
      "Next direction: treat this as an open-data sketch, then validate with zoning, parcel ownership, capital cost, and official demographics.",
    ].join("\n"),
    location: { name: "Calgary, Alberta, Canada", lat: 51.05, lon: -114.07, bbox: [-114.18, 50.95, -113.96, 51.17] },
    candidates: calgaryHospitalCandidates.map((c) => ({
      id: `site-${c.rank}`,
      rank: c.rank,
      lon: c.lon,
      lat: c.lat,
      score: c.score,
      rationale: c.rationale,
      factors: { undersupply: 0.9, demand: 0.7, activity: 0.6, access: 0.55, flood_risk: 0.5, growth_proxy: 0.4, suitability: 0.8 },
      metrics: { coverageGapMeters: c.rank === 1 ? 8400 : 5000, buildingsWithin600m: 18, activityAnchorsWithin800m: 6, roadClass: "primary" },
    })),
    layers: [
      { id: "coverage-rings", name: "2.5 km service rings", kind: "coverage", featureCount: 3, geojson: coverageLayer([[-114.07, 51.05], [-114.02, 51.02], [-114.12, 51.08]], 2500) },
      { id: "ranked-candidates", name: "Ranked candidates", kind: "candidates", featureCount: 5, geojson: candidateLayer(calgaryHospitalCandidates) },
    ],
  }),
  "siting:bridge:lagos": baseFixture({
    answer: [
      "For Lagos, Nigeria, the #1 contender for a new bridge is at 6.46520, 3.39410.",
      "",
      "This crossing contender ranks well because it is farther from existing bridges; it is closer to the water crossing; it keeps access via major arterials.",
      "",
      "Next direction: validate with ferry demand, bathymetry, and municipal crossing plans.",
    ].join("\n"),
    location: { name: "Lagos, Nigeria", lat: 6.45, lon: 3.39, bbox: [3.30, 6.40, 3.48, 6.52] },
    candidates: lagosBridgeCandidates.map((c) => ({
      id: `site-${c.rank}`,
      rank: c.rank,
      lon: c.lon,
      lat: c.lat,
      score: c.score,
      rationale: c.rationale,
      factors: { river_proximity: 0.85, bridge_gap: 0.8, access: 0.6, demand: 0.5 },
    })),
    criteria: [
      { id: "river_proximity", label: "river proximity", weight: 0.35, source: "OSM waterways" },
      { id: "bridge_gap", label: "bridge gap", weight: 0.35, source: "OSM bridges" },
      { id: "access", label: "access", weight: 0.2, source: "OSM arterial class" },
      { id: "demand", label: "demand", weight: 0.1, source: "OSM building density proxy" },
    ],
    layers: [
      { id: "ranked-candidates", name: "Ranked candidates", kind: "candidates", featureCount: 5, geojson: candidateLayer(lagosBridgeCandidates) },
    ],
  }),
  "siting:charging_station:vancouver": baseFixture({
    answer: [
      "For Vancouver, British Columbia, Canada, the #1 contender for a new EV charger is at 49.28270, -123.12070.",
      "",
      "This site offers the best balance among the open-data factors we can measure: sits nearer denser built fabric (higher estimated local demand); is nearer community activity anchors (schools, shops, transit, services); keeps access via major arterials.",
      "",
      "Next direction: confirm curb space, power capacity, and parking rules with the city open data portal.",
    ].join("\n"),
    location: { name: "Vancouver, British Columbia, Canada", lat: 49.28, lon: -123.12, bbox: [-123.20, 49.22, -123.02, 49.34] },
    candidates: vancouverEvCandidates.map((c) => ({
      id: `site-${c.rank}`,
      rank: c.rank,
      lon: c.lon,
      lat: c.lat,
      score: c.score,
      rationale: c.rationale,
      factors: { undersupply: 0.7, demand: 0.85, activity: 0.8, access: 0.6, flood_risk: 0.5, growth_proxy: 0.4, suitability: 0.75 },
      metrics: { coverageGapMeters: 3200, buildingsWithin600m: 40, activityAnchorsWithin800m: 12, roadClass: "secondary" },
    })),
    layers: [
      { id: "ranked-candidates", name: "Ranked candidates", kind: "candidates", featureCount: 5, geojson: candidateLayer(vancouverEvCandidates) },
    ],
  }),
};

/** Return a fast fixture when the ask matches a demo siting key. */
export function demoFixtureForQuestion(question: string): EarthResponse | null {
  const key = askCacheKey(question);
  return FIXTURES[key] ?? null;
}

export function allDemoFixtureKeys(): string[] {
  return Object.keys(FIXTURES);
}
