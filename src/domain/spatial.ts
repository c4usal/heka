/** Stable, backend-independent vocabulary shared by the planner and runtime. */
export type DatasetKind = "roads" | "facilities" | "population" | "flood_zones" | "boundaries" | "land_use";
export type GeometryKind = "point" | "line" | "polygon" | "raster";

export interface DatasetRef {
  id: string;
  name: string;
  kind: DatasetKind;
  geometry: GeometryKind;
  source: string;
  crs: string;
  version: string;
}

export interface Constraint {
  id: string;
  label: string;
  value: string;
  source: "user" | "planner";
}

export interface AnalysisIntent {
  question: string;
  objective: string;
  location?: string;
  desiredOutput: string;
  constraints: Constraint[];
  datasets: DatasetKind[];
}

export type SpatialOperation =
  | { type: "LoadDataset"; datasetId: string }
  | { type: "Buffer"; input: string; distanceMeters: number }
  | { type: "Intersect"; inputs: string[] }
  | { type: "Overlay"; inputs: string[] }
  | { type: "Dissolve"; input: string; field?: string }
  | { type: "Route"; origins: string; network: string; minutes: number; mode: "drive" | "walk" }
  | { type: "RasterMath"; expression: string; inputs: string[] }
  | { type: "Score"; inputs: string[]; weights: Record<string, number> }
  | { type: "Rank"; input: string; limit: number }
  | { type: "Visualize"; input: string; style: "heatmap" | "candidates" | "risk" };

export interface SpatialWorkflow {
  id: string;
  version: "1.0";
  intent: AnalysisIntent;
  operations: SpatialOperation[];
  createdAt: string;
}

export interface ReasoningNode {
  id: string;
  label: string;
  kind: "intent" | "dataset" | "constraint" | "operation" | "output";
  dependsOn: string[];
}

export interface SpatialReasoningGraph {
  nodes: ReasoningNode[];
}
