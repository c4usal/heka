export type DatasetKind = "roads" | "facilities" | "population" | "risk" | "boundaries" | "land_use" | "raster" | "other";

export interface DatasetCatalogEntry {
  id: string;
  name: string;
  kind: DatasetKind;
  geometry: "point" | "line" | "polygon" | "raster";
  aliases: string[];
  description: string;
}

/**
 * This catalog is the contract between planning and the local runtime. A model
 * may request any logical dataset, but only catalogued (or later imported)
 * layers can be executed. It is deliberately data-driven, never question-driven.
 */
export const builtInDatasetCatalog: DatasetCatalogEntry[] = [
  {
    id: "calgary_fire_stations",
    name: "Calgary fire station locations",
    kind: "facilities",
    geometry: "point",
    aliases: ["fire stations", "fire station", "emergency facilities", "emergency facility"],
    description: "Official City of Calgary point locations for existing fire stations.",
  },
  {
    id: "calgary_communities",
    name: "Calgary community districts",
    kind: "boundaries",
    geometry: "polygon",
    aliases: ["communities", "community districts", "neighbourhoods", "neighborhoods", "districts"],
    description: "Official City of Calgary community boundary polygons.",
  },
];

export function plannerDatasetContext(): string {
  return builtInDatasetCatalog.map((dataset) =>
    `- ${dataset.name} [id=${dataset.id}; kind=${dataset.kind}; geometry=${dataset.geometry}]: ${dataset.description}`,
  ).join("\n");
}
