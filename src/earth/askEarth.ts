import { earthApiBaseUrl } from "../config/aiGateway";

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
  dsl?: EarthDslStep[];
  discovery?: EarthDiscovery;
  runtime?: "open-data-tools" | "open-data-tools-fallback" | "qgis-processing";
  engineNote?: string;
};

/** Call the Cloudflare Earth Agent (one brain for web + desktop). */
export async function askEarth(question: string): Promise<EarthResponse> {
  const response = await fetch(`${earthApiBaseUrl()}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const payload = await response.json().catch(() => ({})) as EarthResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Earth Agent failed (${response.status}).`);
  }
  if (!payload.answer || !payload.location) {
    throw new Error("Earth Agent returned an incomplete response.");
  }
  return payload;
}

export function exportEarthGeoJson(earth: Pick<EarthResponse, "layers" | "location" | "candidates">): void {
  const collection = {
    type: "FeatureCollection",
    properties: {
      place: earth.location.name,
      exportedAt: new Date().toISOString(),
      candidateCount: earth.candidates.length,
    },
    features: earth.layers.flatMap((layer) => {
      try {
        const parsed = JSON.parse(layer.geojson) as { features?: unknown[] };
        return (parsed.features ?? []).map((feature) => {
          const f = feature as { properties?: Record<string, unknown> };
          return {
            ...f,
            properties: { ...(f.properties ?? {}), hekaLayer: layer.name, hekaKind: layer.kind },
          };
        });
      } catch {
        return [];
      }
    }),
  };
  const blob = new Blob([JSON.stringify(collection)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `heka-${earth.location.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.geojson`;
  anchor.click();
  URL.revokeObjectURL(url);
}
