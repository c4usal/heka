import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentProgressStep, Analysis, CameraTarget, Dataset, DatasetResolutionState, ExecutionResult, ExecutionState, MapFocus, MapLayer, NavigationSection, PanelLayout, PlannerPlan, PlannerState, Project, RankedCandidate, RuntimeState, SelectedMapFeature, TimelineState, Workspace } from "../types/workspace";

const project: Project = { id: "calgary-study", name: "Calgary Infrastructure Study", path: "C:/Heka/Calgary Infrastructure Study", updatedAt: "Just now" };
const datasets: Dataset[] = [{ id: "roads", name: "Calgary road network", kind: "network", source: "OpenStreetMap", visible: true }, { id: "population", name: "Population distribution", kind: "vector", source: "Statistics Canada", visible: true }, { id: "flood-risk", name: "Flood hazard zones", kind: "vector", source: "Alberta Open Data", visible: true }];
const analyses: Analysis[] = [{ id: "emergency-coverage", name: "Emergency coverage study", status: "draft", createdAt: "Today" }];
const layout: PanelLayout = { left: 17, center: 58, right: 25, bottom: 23 };
const timelineSteps = ["Understanding request", "Checking evidence needs", "Acquiring open data", "Scoring candidates", "Rendering map", "Done"];

interface WorkspaceStore {
  workspace: Workspace;
  chatCollapsed: boolean;
  datasets: Dataset[];
  datasetResolutions: DatasetResolutionState[];
  resolvedMapLayers: MapLayer[];
  mapFocus?: MapFocus;
  cameraTarget?: CameraTarget;
  rankedCandidates: RankedCandidate[];
  agentSteps: AgentProgressStep[];
  toast?: string;
  analyses: Analysis[];
  timeline: TimelineState;
  planner: PlannerState;
  runtime: RuntimeState;
  execution: ExecutionState;
  setSection(section: NavigationSection): void;
  toggleSidebar(): void;
  toggleChatCollapsed(): void;
  setHorizontalLayout(layout: Pick<PanelLayout, "left" | "center" | "right">): void;
  setBottomSize(bottom: number): void;
  setTimelinePlaying(isPlaying: boolean): void;
  setRuntime(runtime: RuntimeState): void;
  beginPlanning(): void;
  setAgentSteps(steps: AgentProgressStep[]): void;
  markAgentStep(id: string, status: AgentProgressStep["status"]): void;
  applyPlan(plan: PlannerPlan): void;
  setDatasetResolutions(resolutions: DatasetResolutionState[]): void;
  addResolvedMapLayer(layer: MapLayer): void;
  clearAgentMapLayers(): void;
  clearResolvedMapLayers(): void;
  setMapFocus(focus?: MapFocus): void;
  setCameraTarget(target?: CameraTarget): void;
  setRankedCandidates(candidates: RankedCandidate[]): void;
  showToast(message: string): void;
  clearToast(): void;
  failPlanning(error: string): void;
  completeTimelineStep(index: number): void;
  beginExecution(): void;
  updateExecution(stage: string, progress: number, detail: string): void;
  completeExecution(result: ExecutionResult): void;
  selectMapFeature(feature?: SelectedMapFeature): void;
  failExecution(error: string): void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(persist((set) => ({
  workspace: { activeProject: project, activeSection: "projects", layout, isSidebarCollapsed: false },
  chatCollapsed: false,
  datasets,
  datasetResolutions: [],
  resolvedMapLayers: [],
  rankedCandidates: [],
  agentSteps: [],
  analyses,
  timeline: { progress: 0, isPlaying: false, steps: timelineSteps.map((label) => ({ id: label.toLowerCase().replaceAll(" ", "-"), label, status: "pending" })) },
  planner: { status: "ready", notes: ["Planner is ready for a spatial objective.", "No workflow has been generated."] },
  runtime: { status: "ready", backend: "Earth Agent (Cloudflare)" },
  execution: { status: "idle", progress: 0 },
  setSection: (activeSection) => set((state) => ({ workspace: { ...state.workspace, activeSection } })),
  toggleSidebar: () => set((state) => ({ workspace: { ...state.workspace, isSidebarCollapsed: !state.workspace.isSidebarCollapsed } })),
  toggleChatCollapsed: () => set((state) => ({ chatCollapsed: !state.chatCollapsed })),
  setHorizontalLayout: (horizontal) => set((state) => ({ workspace: { ...state.workspace, layout: { ...state.workspace.layout, ...horizontal } } })),
  setBottomSize: (bottom) => set((state) => ({ workspace: { ...state.workspace, layout: { ...state.workspace.layout, bottom } } })),
  setTimelinePlaying: (isPlaying) => set((state) => ({ timeline: { ...state.timeline, isPlaying } })),
  setRuntime: (runtime) => set({ runtime }),
  beginPlanning: () => set((state) => ({
    planner: { ...state.planner, status: "planning", error: undefined },
    // Keep user imports; clear previous agent layers only.
    resolvedMapLayers: state.resolvedMapLayers.filter((layer) => layer.source === "import"),
    rankedCandidates: [],
    agentSteps: timelineSteps.map((label, index) => ({
      id: label.toLowerCase().replaceAll(" ", "-"),
      label,
      status: index === 0 ? "active" : "pending",
    })),
    execution: { status: "idle", progress: 0, selectedFeature: undefined },
    timeline: { ...state.timeline, progress: 0, steps: state.timeline.steps.map((step) => ({ ...step, status: "pending" as const })) },
  })),
  setAgentSteps: (agentSteps) => set({ agentSteps }),
  markAgentStep: (id, status) => set((state) => ({
    agentSteps: state.agentSteps.map((step) => {
      if (step.id === id) return { ...step, status };
      if (status === "active" && step.status === "active") return { ...step, status: "done" };
      return step;
    }),
  })),
  applyPlan: (plan) => set((state) => ({
    planner: { status: "complete", plan, notes: [plan.answer] },
    agentSteps: state.agentSteps.map((step) => ({ ...step, status: "done" as const })),
    timeline: { ...state.timeline, progress: 100 },
  })),
  setDatasetResolutions: (datasetResolutions) => set({ datasetResolutions }),
  addResolvedMapLayer: (layer) => set((state) => ({
    resolvedMapLayers: [...state.resolvedMapLayers.filter((current) => current.id !== layer.id), layer],
  })),
  clearAgentMapLayers: () => set((state) => ({
    resolvedMapLayers: state.resolvedMapLayers.filter((layer) => layer.source === "import"),
  })),
  clearResolvedMapLayers: () => set({ resolvedMapLayers: [] }),
  setMapFocus: (mapFocus) => set({ mapFocus }),
  setCameraTarget: (cameraTarget) => set({ cameraTarget }),
  setRankedCandidates: (rankedCandidates) => set({ rankedCandidates }),
  showToast: (toast) => set({ toast }),
  clearToast: () => set({ toast: undefined }),
  failPlanning: (error) => set((state) => ({
    planner: { ...state.planner, status: "error", error },
    agentSteps: state.agentSteps.map((step) => step.status === "active" ? { ...step, status: "error" as const } : step),
  })),
  completeTimelineStep: (index) => set((state) => ({
    timeline: {
      ...state.timeline,
      progress: Math.round(((index + 1) / state.timeline.steps.length) * 100),
      steps: state.timeline.steps.map((step, stepIndex) => ({ ...step, status: stepIndex <= index ? "complete" : "pending" })),
    },
  })),
  beginExecution: () => set({ execution: { status: "running", progress: 0 } }),
  updateExecution: (stage, progress, detail) => set((state) => ({ execution: { ...state.execution, status: "running", stage, progress, detail } })),
  completeExecution: (result) => set({ execution: { status: "complete", progress: 100, result } }),
  selectMapFeature: (selectedFeature) => set((state) => ({ execution: { ...state.execution, selectedFeature } })),
  failExecution: (error) => set((state) => ({ execution: { ...state.execution, status: "error", error } })),
}), { name: "heka-workspace-shell", partialize: (state) => ({ workspace: state.workspace, chatCollapsed: state.chatCollapsed }) }));
