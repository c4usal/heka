import { create } from "zustand";
import type { RuntimeEvent } from "../../application/ports";
import type { DatasetRef, SpatialReasoningGraph, SpatialWorkflow } from "../../domain/spatial";

export const seedDatasets: DatasetRef[] = [
  { id: "roads", name: "Calgary road network", kind: "roads", geometry: "line", source: "OpenStreetMap", crs: "EPSG:4326", version: "2026.07" },
  { id: "facilities", name: "Emergency facilities", kind: "facilities", geometry: "point", source: "Open Calgary", crs: "EPSG:4326", version: "2026.01" },
  { id: "population", name: "Population distribution", kind: "population", geometry: "polygon", source: "Statistics Canada", crs: "EPSG:4326", version: "2021" },
  { id: "flood-zones", name: "Flood hazard zones", kind: "flood_zones", geometry: "polygon", source: "Alberta Open Data", crs: "EPSG:4326", version: "2025.11" }
];

interface WorkspaceState {
  datasets: DatasetRef[];
  question: string;
  workflow?: SpatialWorkflow;
  graph?: SpatialReasoningGraph;
  events: RuntimeEvent[];
  activePanel: "projects" | "datasets" | "layers" | "plugins" | "history";
  isPlanning: boolean;
  setQuestion(question: string): void;
  setPlan(workflow: SpatialWorkflow, graph: SpatialReasoningGraph): void;
  addEvent(event: RuntimeEvent): void;
  setPlanning(isPlanning: boolean): void;
  setActivePanel(panel: WorkspaceState["activePanel"]): void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  datasets: seedDatasets,
  question: "Where should Calgary place a new emergency facility to improve coverage while avoiding flood risk?",
  events: [], activePanel: "projects", isPlanning: false,
  setQuestion: (question) => set({ question }),
  setPlan: (workflow, graph) => set({ workflow, graph, events: [] }),
  addEvent: (event) => set((state) => ({ events: [...state.events, event] })),
  setPlanning: (isPlanning) => set({ isPlanning }),
  setActivePanel: (activePanel) => set({ activePanel })
}));
