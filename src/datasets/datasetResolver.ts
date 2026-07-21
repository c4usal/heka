import { builtInDatasetCatalog, type DatasetKind } from "./datasetCatalog";
import type { PlannerPlan } from "../types/workspace";
import { invoke } from "@tauri-apps/api/core";

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

/**
 * Resolves data provenance without allowing the model to create URLs or run
 * arbitrary download queries. Provider choices are reviewed application data.
 */
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
    return { id: `resolution-${index}`, datasetName: dataset.name, kind: dataset.kind, ...source };
  });
}

export type OpenStreetMapDiscovery = { sourceName: string; featureCount: number; detail: string };

/** User-triggered discovery only: public Overpass must not be queried in bulk. */
export async function discoverOpenStreetMapDataset(datasetName: string, geographicScope: string): Promise<OpenStreetMapDiscovery> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("OpenStreetMap discovery requires the Heka desktop application.");
  return invoke<OpenStreetMapDiscovery>("discover_osm_dataset", { request: { datasetName, geographicScope } });
}
