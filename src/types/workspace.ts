export type NavigationSection = "projects" | "datasets" | "layers" | "history" | "plugins";

export interface Project { id: string; name: string; path: string; updatedAt: string; }
export interface Dataset { id: string; name: string; kind: "vector" | "raster" | "network"; source: string; visible: boolean; }
export interface Analysis { id: string; name: string; status: "draft" | "ready" | "running" | "complete"; createdAt: string; }
export interface TimelineState { progress: number; isPlaying: boolean; steps: Array<{ id: string; label: string; status: "pending" | "ready" | "complete" }>; }
export interface GraphNode { id: string; label: string; kind: "question" | "dataset" | "operation" | "output"; }
export interface GraphEdge { from: string; to: string; }
export interface SpatialDslStep { id: string; operation: string; label: string; inputs: string[]; parameters: Array<{ name: string; value: string | number | boolean | null }>; rationale: string; }
export interface PlannerPlan { question: string; objective: string; location: string | null; geographicScope: string; requiredDatasets: Array<{ name: string; purpose: string; kind: string }>; constraints: Array<{ label: string; value: string; source: "user" | "planner" }>; assumptions: string[]; desiredOutput: string; workflowSummary: string; confidence: number; clarificationQuestions: string[]; executionReadiness: "ready" | "needs_data" | "needs_clarification" | "unsupported"; graph: { nodes: GraphNode[]; edges: GraphEdge[] }; dsl: SpatialDslStep[]; }
export interface PlannerState { status: "idle" | "ready" | "planning" | "complete" | "error"; notes: string[]; plan?: PlannerPlan; error?: string; }
export interface RuntimeState { status: "offline" | "ready" | "running"; backend: string; }
export type MapLayerKind = "stations" | "coverage" | "gaps" | "candidates" | "generic";
export interface MapLayer { id: string; name: string; kind: MapLayerKind; geojson: string; featureCount: number; outputPath: string; }
export interface SelectedMapFeature { layerName: string; featureId: string; properties: Record<string, unknown>; }
export interface ExecutionResult { layerName: string; geojson: string; outputPath: string; featureCount: number; elapsedMs: number; warnings: string[]; mapLayers?: MapLayer[]; }
export interface ExecutionState { status: "idle" | "running" | "complete" | "error"; stage?: string; progress: number; detail?: string; result?: ExecutionResult; selectedFeature?: SelectedMapFeature; error?: string; }
export interface PanelLayout { left: number; center: number; right: number; bottom: number; }
export interface Workspace { activeProject: Project; activeSection: NavigationSection; layout: PanelLayout; isSidebarCollapsed: boolean; }
