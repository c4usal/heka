import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Analysis, Dataset, ExecutionResult, ExecutionState, NavigationSection, PanelLayout, PlannerPlan, PlannerState, Project, RuntimeState, TimelineState, Workspace } from "../types/workspace";

const project: Project = { id: "calgary-study", name: "Calgary Infrastructure Study", path: "C:/Heka/Calgary Infrastructure Study", updatedAt: "Just now" };
const datasets: Dataset[] = [{ id: "roads", name: "Calgary road network", kind: "network", source: "OpenStreetMap", visible: true }, { id: "population", name: "Population distribution", kind: "vector", source: "Statistics Canada", visible: true }, { id: "flood-risk", name: "Flood hazard zones", kind: "vector", source: "Alberta Open Data", visible: true }];
const analyses: Analysis[] = [{ id: "emergency-coverage", name: "Emergency coverage study", status: "draft", createdAt: "Today" }];
const layout: PanelLayout = { left: 17, center: 58, right: 25, bottom: 23 };
const timelineSteps = ["Question", "Intent Extraction", "Dataset Resolution", "Constraint Resolution", "Reasoning Graph", "Spatial DSL", "Planner Complete"];

interface WorkspaceStore { workspace: Workspace; datasets: Dataset[]; analyses: Analysis[]; timeline: TimelineState; planner: PlannerState; runtime: RuntimeState; execution: ExecutionState; setSection(section: NavigationSection): void; toggleSidebar(): void; setHorizontalLayout(layout: Pick<PanelLayout, "left" | "center" | "right">): void; setBottomSize(bottom: number): void; setTimelinePlaying(isPlaying: boolean): void; beginPlanning(): void; applyPlan(plan: PlannerPlan): void; failPlanning(error: string): void; completeTimelineStep(index: number): void; beginExecution(): void; updateExecution(stage: string, progress: number, detail: string): void; completeExecution(result: ExecutionResult): void; failExecution(error: string): void; }

export const useWorkspaceStore = create<WorkspaceStore>()(persist((set) => ({
  workspace: { activeProject: project, activeSection: "projects", layout, isSidebarCollapsed: false }, datasets, analyses,
  timeline: { progress: 0, isPlaying: false, steps: timelineSteps.map((label) => ({ id: label.toLowerCase().replaceAll(" ", "-"), label, status: "pending" })) },
  planner: { status: "ready", notes: ["Planner is ready for a spatial objective.", "No workflow has been generated."] }, runtime: { status: "ready", backend: "PyQGIS adapter (local)" }, execution: { status: "idle", progress: 0 },
  setSection: (activeSection) => set((state) => ({ workspace: { ...state.workspace, activeSection } })), toggleSidebar: () => set((state) => ({ workspace: { ...state.workspace, isSidebarCollapsed: !state.workspace.isSidebarCollapsed } })),
  setHorizontalLayout: (horizontal) => set((state) => ({ workspace: { ...state.workspace, layout: { ...state.workspace.layout, ...horizontal } } })), setBottomSize: (bottom) => set((state) => ({ workspace: { ...state.workspace, layout: { ...state.workspace.layout, bottom } } })), setTimelinePlaying: (isPlaying) => set((state) => ({ timeline: { ...state.timeline, isPlaying } })),
  beginPlanning: () => set((state) => ({ planner: { ...state.planner, status: "planning", error: undefined }, timeline: { ...state.timeline, progress: 0, steps: state.timeline.steps.map((step) => ({ ...step, status: "pending" })) } })),
  applyPlan: (plan) => set((state) => ({ planner: { status: "complete", plan, notes: [plan.workflowSummary] }, timeline: { ...state.timeline, progress: 0 } })), failPlanning: (error) => set((state) => ({ planner: { ...state.planner, status: "error", error } })),
  completeTimelineStep: (index) => set((state) => ({ timeline: { ...state.timeline, progress: Math.round(((index + 1) / state.timeline.steps.length) * 100), steps: state.timeline.steps.map((step, stepIndex) => ({ ...step, status: stepIndex <= index ? "complete" : "pending" })) } })),
  beginExecution: () => set({ execution: { status: "running", progress: 0 } }), updateExecution: (stage, progress, detail) => set((state) => ({ execution: { ...state.execution, status: "running", stage, progress, detail } })), completeExecution: (result) => set({ execution: { status: "complete", progress: 100, result } }), failExecution: (error) => set((state) => ({ execution: { ...state.execution, status: "error", error } }))
}), { name: "heka-workspace-shell", partialize: (state) => ({ workspace: state.workspace }) }));
