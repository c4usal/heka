/** Shared Earth Agent response contract (UI + Worker). */

export type EarthCriterion = {
  id: string;
  label: string;
  weight: number;
  source: string;
};

export type EarthCandidate = {
  id: string;
  rank: number;
  lon: number;
  lat: number;
  score: number;
  rationale: string;
  factors: Record<string, number>;
  /** Absolute open-data measurements used in the explanation (not normalized). */
  metrics?: Record<string, number | string>;
};

export type EarthLayer = {
  id: string;
  name: string;
  kind: "stations" | "coverage" | "gaps" | "candidates" | "generic" | "roads" | "waterways" | "bridges";
  geojson: string;
  featureCount: number;
};

export type EarthTraceStep = {
  tool: string;
  summary: string;
};

export type EarthNextAction = {
  label: string;
  action: string;
};

export type EarthDslStep = {
  id: string;
  operation: string;
  label: string;
  inputs: string[];
  rationale: string;
};

export type EarthDiscoveryItem = {
  id: string;
  label: string;
  connector?: string;
  status?: string;
  featureCount?: number;
  reason?: string;
};

export type EarthDiscovery = {
  need: EarthDiscoveryItem[];
  found: EarthDiscoveryItem[];
  missing: EarthDiscoveryItem[];
};

export type EarthResponse = {
  answer: string;
  location: { name: string; lat: number; lon: number; bbox: [number, number, number, number] };
  criteria: EarthCriterion[];
  candidates: EarthCandidate[];
  layers: EarthLayer[];
  assumptions: string[];
  limitations: string[];
  confidence: number;
  trace: EarthTraceStep[];
  next_actions: EarthNextAction[];
  /** Declarative workflow the agent planned — engines execute; the model does not. */
  dsl: EarthDslStep[];
  /** Need → Found / Missing from plan_evidence + acquire. */
  discovery: EarthDiscovery;
  /** Which compute path produced the MapProduct. */
  runtime: "open-data-tools" | "open-data-tools-fallback" | "qgis-processing";
  engineNote: string;
};

export type LonLat = { lon: number; lat: number };

export type GeoFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown };
};
