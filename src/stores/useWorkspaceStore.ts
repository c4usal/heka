import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AgentProgressStep,
  Analysis,
  CameraTarget,
  Dataset,
  DatasetResolutionState,
  DocumentChatMessage,
  DocumentTab,
  ExecutionResult,
  ExecutionState,
  MapFocus,
  MapLayer,
  NavigationSection,
  PanelLayout,
  PlannerPlan,
  PlannerState,
  Project,
  QgisRuntimeHealth,
  RankedCandidate,
  RuntimeState,
  SelectedMapFeature,
  TimelineState,
  Workspace,
} from "../types/workspace";

const project: Project = { id: "calgary-study", name: "Calgary Infrastructure Study", path: "C:/Heka/Calgary Infrastructure Study", updatedAt: "Just now" };
const datasets: Dataset[] = [
  { id: "roads", name: "Calgary road network", kind: "network", source: "OpenStreetMap", visible: true },
  { id: "population", name: "Population distribution", kind: "vector", source: "Statistics Canada", visible: true },
  { id: "flood-risk", name: "Flood hazard zones", kind: "vector", source: "Alberta Open Data", visible: true },
];
const analyses: Analysis[] = [{ id: "emergency-coverage", name: "Emergency coverage study", status: "draft", createdAt: "Today" }];
const layout: PanelLayout = { left: 17, center: 58, right: 25, bottom: 23 };
const timelineSteps = ["Understanding request", "Checking evidence needs", "Acquiring open data", "Scoring candidates", "Rendering map", "Done"];

function newDocumentId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDocumentTab(title = "Earth map"): DocumentTab {
  return {
    id: newDocumentId(),
    title,
    layers: [],
    rankedCandidates: [],
    chatMessages: [],
  };
}

const initialDoc = createDocumentTab("Earth map");

function patchActiveDocument(
  state: { documents: DocumentTab[]; activeDocumentId: string },
  patch: Partial<DocumentTab>,
): DocumentTab[] {
  return state.documents.map((doc) => (doc.id === state.activeDocumentId ? { ...doc, ...patch } : doc));
}

function activeDoc(state: { documents: DocumentTab[]; activeDocumentId: string }): DocumentTab {
  return state.documents.find((doc) => doc.id === state.activeDocumentId) ?? state.documents[0] ?? createDocumentTab();
}

interface WorkspaceStore {
  workspace: Workspace;
  chatCollapsed: boolean;
  inspectorOpen: boolean;
  documents: DocumentTab[];
  activeDocumentId: string;
  datasets: Dataset[];
  datasetResolutions: DatasetResolutionState[];
  /** Mirrored from the active document for existing panels. */
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
  qgisHealth?: QgisRuntimeHealth;
  setSection(section: NavigationSection): void;
  toggleSidebar(): void;
  toggleChatCollapsed(): void;
  toggleInspector(): void;
  setInspectorOpen(open: boolean): void;
  setHorizontalLayout(layout: Pick<PanelLayout, "left" | "center" | "right">): void;
  setBottomSize(bottom: number): void;
  setTimelinePlaying(isPlaying: boolean): void;
  setRuntime(runtime: RuntimeState): void;
  setQgisHealth(health: QgisRuntimeHealth): void;
  addDocument(title?: string): string;
  closeDocument(id: string): void;
  setActiveDocument(id: string): void;
  renameActiveDocument(title: string): void;
  setActiveChatMessages(messages: DocumentChatMessage[]): void;
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

export const useWorkspaceStore = create<WorkspaceStore>()(persist((set, get) => ({
  workspace: { activeProject: project, activeSection: "projects", layout, isSidebarCollapsed: false },
  chatCollapsed: false,
  inspectorOpen: true,
  documents: [initialDoc],
  activeDocumentId: initialDoc.id,
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
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setHorizontalLayout: (horizontal) => set((state) => ({ workspace: { ...state.workspace, layout: { ...state.workspace.layout, ...horizontal } } })),
  setBottomSize: (bottom) => set((state) => ({ workspace: { ...state.workspace, layout: { ...state.workspace.layout, bottom } } })),
  setTimelinePlaying: (isPlaying) => set((state) => ({ timeline: { ...state.timeline, isPlaying } })),
  setRuntime: (runtime) => set({ runtime }),
  setQgisHealth: (qgisHealth) => set({ qgisHealth }),
  addDocument: (title) => {
    const doc = createDocumentTab(title ?? `Map ${get().documents.length + 1}`);
    set((state) => ({
      documents: [...state.documents, doc],
      activeDocumentId: doc.id,
      resolvedMapLayers: [],
      cameraTarget: undefined,
      rankedCandidates: [],
      mapFocus: undefined,
      planner: { status: "ready", notes: ["New document — ask Earth a question."] },
      execution: { status: "idle", progress: 0 },
      agentSteps: [],
    }));
    return doc.id;
  },
  closeDocument: (id) => set((state) => {
    if (state.documents.length <= 1) return state;
    const documents = state.documents.filter((doc) => doc.id !== id);
    const closingActive = state.activeDocumentId === id;
    const next = closingActive ? documents[documents.length - 1] : activeDoc(state);
    const activeDocumentId = closingActive ? next.id : state.activeDocumentId;
    const active = documents.find((doc) => doc.id === activeDocumentId) ?? documents[0];
    return {
      documents,
      activeDocumentId: active.id,
      resolvedMapLayers: active.layers,
      cameraTarget: active.cameraTarget,
      rankedCandidates: active.rankedCandidates,
    };
  }),
  setActiveDocument: (id) => set((state) => {
    const current = activeDoc(state);
    const saved = state.documents.map((doc) =>
      doc.id === current.id
        ? {
            ...doc,
            layers: state.resolvedMapLayers,
            cameraTarget: state.cameraTarget,
            rankedCandidates: state.rankedCandidates,
          }
        : doc,
    );
    const next = saved.find((doc) => doc.id === id);
    if (!next) return state;
    return {
      documents: saved,
      activeDocumentId: next.id,
      resolvedMapLayers: next.layers,
      cameraTarget: next.cameraTarget,
      rankedCandidates: next.rankedCandidates,
      planner: { status: "ready", notes: next.chatMessages.length ? ["Continuing this document."] : ["Ask Earth a question."] },
      execution: { status: "idle", progress: 0 },
      agentSteps: [],
    };
  }),
  renameActiveDocument: (title) => set((state) => ({
    documents: patchActiveDocument(state, { title }),
  })),
  setActiveChatMessages: (chatMessages) => set((state) => ({
    documents: patchActiveDocument(state, { chatMessages }),
  })),
  beginPlanning: () => set((state) => {
    const layers = state.resolvedMapLayers.filter((layer) => layer.source === "import");
    return {
      planner: { ...state.planner, status: "planning", error: undefined },
      resolvedMapLayers: layers,
      rankedCandidates: [],
      documents: patchActiveDocument(state, { layers, rankedCandidates: [] }),
      agentSteps: timelineSteps.map((label, index) => ({
        id: label.toLowerCase().replaceAll(" ", "-"),
        label,
        status: index === 0 ? "active" : "pending",
      })),
      execution: { status: "idle", progress: 0, selectedFeature: undefined },
      timeline: { ...state.timeline, progress: 0, steps: state.timeline.steps.map((step) => ({ ...step, status: "pending" as const })) },
    };
  }),
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
    documents: patchActiveDocument(state, {
      title: plan.location || plan.geographicScope || activeDoc(state).title,
    }),
  })),
  setDatasetResolutions: (datasetResolutions) => set({ datasetResolutions }),
  addResolvedMapLayer: (layer) => set((state) => {
    const layers = [...state.resolvedMapLayers.filter((current) => current.id !== layer.id), layer];
    return {
      resolvedMapLayers: layers,
      documents: patchActiveDocument(state, { layers }),
    };
  }),
  clearAgentMapLayers: () => set((state) => {
    const layers = state.resolvedMapLayers.filter((layer) => layer.source === "import");
    return {
      resolvedMapLayers: layers,
      documents: patchActiveDocument(state, { layers }),
    };
  }),
  clearResolvedMapLayers: () => set((state) => ({
    resolvedMapLayers: [],
    documents: patchActiveDocument(state, { layers: [] }),
  })),
  setMapFocus: (mapFocus) => set({ mapFocus }),
  setCameraTarget: (cameraTarget) => set((state) => ({
    cameraTarget,
    documents: patchActiveDocument(state, { cameraTarget }),
  })),
  setRankedCandidates: (rankedCandidates) => set((state) => ({
    rankedCandidates,
    documents: patchActiveDocument(state, { rankedCandidates }),
  })),
  showToast: (toast) => set({ toast }),
  clearToast: () => set({ toast: undefined }),
  failPlanning: (error) => set((state) => ({
    planner: { ...state.planner, status: "error", error },
    agentSteps: state.agentSteps.map((step) => (step.status === "active" ? { ...step, status: "error" as const } : step)),
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
}), {
  name: "heka-workspace-shell-v2",
  partialize: (state) => ({
    workspace: state.workspace,
    chatCollapsed: state.chatCollapsed,
    inspectorOpen: state.inspectorOpen,
    documents: state.documents.map((doc) => ({
      ...doc,
      // Keep chat; drop huge geojson from persist to avoid quota blowups — layers re-asked live.
      layers: doc.layers.filter((layer) => layer.source === "import").map((layer) => ({
        ...layer,
        geojson: layer.geojson.length > 200_000 ? "{\"type\":\"FeatureCollection\",\"features\":[]}" : layer.geojson,
      })),
    })),
    activeDocumentId: state.activeDocumentId,
  }),
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    const active = state.documents.find((doc) => doc.id === state.activeDocumentId) ?? state.documents[0];
    if (!active) return;
    state.resolvedMapLayers = active.layers;
    state.cameraTarget = active.cameraTarget;
    state.rankedCandidates = active.rankedCandidates;
  },
}));
