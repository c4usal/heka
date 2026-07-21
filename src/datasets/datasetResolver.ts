import { builtInDatasetCatalog, type DatasetKind } from "./datasetCatalog";
import type { MapLayerKind, PlannerPlan } from "../types/workspace";
import { invoke } from "@tauri-apps/api/core";
import { earthApiBaseUrl, isTauriRuntime } from "../config/aiGateway";

export type ResolutionStatus = "workspace" | "discoverable" | "needs_import" | "unsupported";

export interface DatasetResolution {
  id: string;
  datasetName: string;
  kind: string;
  status: ResolutionStatus;
  sourceName: string;
  sourceUrl?: string;
  detail: string;
  canAcquireAutomatically: boolean;
}

export interface PlaceFocus {
  displayName: string;
  lat: number;
  lon: number;
  south: number;
  north: number;
  west: number;
  east: number;
}

const sourceForKind: Record<DatasetKind, Omit<DatasetResolution, "id" | "datasetName" | "kind">> = {
  roads: { status: "discoverable", sourceName: "OpenStreetMap", sourceUrl: "https://www.openstreetmap.org/", detail: "Road networks can be acquired from OpenStreetMap for the requested place.", canAcquireAutomatically: true },
  facilities: { status: "discoverable", sourceName: "OpenStreetMap", sourceUrl: "https://www.openstreetmap.org/", detail: "Mapped public facilities can be discovered from OpenStreetMap; verify completeness before operational use.", canAcquireAutomatically: true },
  boundaries: { status: "discoverable", sourceName: "OpenStreetMap / local authority portal", sourceUrl: "https://www.openstreetmap.org/", detail: "Administrative boundaries can be discovered from OpenStreetMap or a city open-data portal.", canAcquireAutomatically: true },
  land_use: { status: "discoverable", sourceName: "OpenStreetMap", sourceUrl: "https://www.openstreetmap.org/", detail: "Land-use polygons can be discovered from OpenStreetMap; authoritative zoning requires the local planning portal.", canAcquireAutomatically: true },
  population: { status: "needs_import", sourceName: "Official census or municipal open data", detail: "Population data needs an authoritative local source; Heka will not infer it from map features.", canAcquireAutomatically: false },
  risk: { status: "needs_import", sourceName: "Authoritative hazard/open-data portal", detail: "Flood, wildfire, and other hazard layers must come from the responsible public authority.", canAcquireAutomatically: false },
  raster: { status: "needs_import", sourceName: "STAC imagery catalog", sourceUrl: "https://stacspec.org/", detail: "Raster imagery or elevation requires a selected STAC or authority data source.", canAcquireAutomatically: false },
  other: { status: "needs_import", sourceName: "Local workspace or approved data catalog", detail: "This data type needs an imported local dataset or an approved catalog connector.", canAcquireAutomatically: false },
};

function normalized(value: string) { return value.trim().toLowerCase(); }

export function isOpenStreetMapDiscoverableName(name: string): boolean {
  return /(road|street|highway|corridor|bridge|crossing|building|footprint|river|waterway|stream|canal|creek|lake|water|park|hospital|clinic|school|university|college|charger|charging|fire\s*station|police|library|boundary|district|neighbourhood|neighborhood|land\s*use|landuse|zoning|facility|facilities|amenity|restaurant|cafe|bank)/i.test(name);
}

export function mapLayerKindForDataset(name: string, kind: string): MapLayerKind {
  const value = `${name} ${kind}`.toLowerCase();
  if (/(bridge|crossing)/.test(value)) return "bridges";
  if (/(river|waterway|stream|canal|creek|lake|water)/.test(value)) return "waterways";
  if (/(road|street|highway|corridor)/.test(value)) return "roads";
  if (/(station|hospital|school|facility|charger|fire)/.test(value)) return "stations";
  if (/(building|footprint)/.test(value)) return "generic";
  return "generic";
}

export function resolvePlanDatasets(plan: PlannerPlan): DatasetResolution[] {
  return plan.requiredDatasets.map((dataset, index) => {
    const name = normalized(dataset.name);
    const local = builtInDatasetCatalog.find((entry) =>
      entry.name.toLowerCase() === name || entry.aliases.some((alias) => name.includes(alias)),
    );
    if (local) return {
      id: `resolution-${index}`, datasetName: dataset.name, kind: dataset.kind, status: "workspace",
      sourceName: "Heka workspace", detail: `${local.name} is registered locally and ready for a validated runtime.`, canAcquireAutomatically: false,
    };
    const kind = dataset.kind as DatasetKind;
    const source = sourceForKind[kind] ?? sourceForKind.other;
    if (source.canAcquireAutomatically || isOpenStreetMapDiscoverableName(dataset.name)) {
      return {
        id: `resolution-${index}`, datasetName: dataset.name, kind: dataset.kind,
        status: "discoverable", sourceName: "OpenStreetMap", sourceUrl: "https://www.openstreetmap.org/",
        detail: "Heka will acquire this layer from OpenStreetMap for the requested place.", canAcquireAutomatically: true,
      };
    }
    return { id: `resolution-${index}`, datasetName: dataset.name, kind: dataset.kind, ...source };
  });
}

export type OpenStreetMapDiscovery = {
  sourceName: string;
  featureCount: number;
  detail: string;
  geojson: string;
  outputPath: string;
  place: PlaceFocus;
};

export type BridgeSitingContext = {
  place: PlaceFocus;
  roads: OpenStreetMapDiscovery;
  waterways: OpenStreetMapDiscovery;
  bridges: OpenStreetMapDiscovery;
  detail: string;
};

export type FacilityGapContext = {
  place: PlaceFocus;
  roads: OpenStreetMapDiscovery;
  facilities: OpenStreetMapDiscovery;
  detail: string;
  amenity: string;
};

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${earthApiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Earth API ${path} failed (${response.status}).`);
  return payload;
}

export async function geocodePlace(geographicScope: string): Promise<PlaceFocus> {
  if (isTauriRuntime()) {
    return invoke<PlaceFocus>("geocode_place", { request: { geographicScope } });
  }
  return apiPost<PlaceFocus>("/api/geocode", { geographicScope });
}

export async function discoverOpenStreetMapDataset(datasetName: string, geographicScope: string, kind?: string): Promise<OpenStreetMapDiscovery> {
  if (isTauriRuntime()) {
    return invoke<OpenStreetMapDiscovery>("discover_osm_dataset", { request: { datasetName, geographicScope, kind } });
  }
  return apiPost<OpenStreetMapDiscovery>("/api/osm/dataset", { datasetName, geographicScope, kind });
}

export async function discoverBridgeSitingContext(geographicScope: string): Promise<BridgeSitingContext> {
  if (isTauriRuntime()) {
    return invoke<BridgeSitingContext>("discover_bridge_siting_context", { request: { geographicScope } });
  }
  return apiPost<BridgeSitingContext>("/api/osm/bridge-context", { geographicScope });
}

export async function discoverFacilityGapContext(geographicScope: string, amenity: string): Promise<FacilityGapContext> {
  if (isTauriRuntime()) {
    return invoke<FacilityGapContext>("discover_facility_gap_context", { request: { geographicScope, amenity } });
  }
  return apiPost<FacilityGapContext>("/api/osm/facility-context", { geographicScope, amenity });
}

export function formatInvokeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  try { return JSON.stringify(error); } catch { return "unavailable"; }
}
