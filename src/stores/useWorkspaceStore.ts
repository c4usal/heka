import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Analysis, Dataset, NavigationSection, PanelLayout, PlannerState, Project, RuntimeState, TimelineState, Workspace } from "../types/workspace";

const project: Project = { id: "calgary-study", name: "Calgary Infrastructure Study", path: "C:/Heka/Calgary Infrastructure Study", updatedAt: "Just now" };
const datasets: Dataset[] = [
  { id: "roads", name: "Calgary road network", kind: "network", source: "OpenStreetMap", visible: true },
  { id: "population", name: "Population distribution", kind: "vector", source: "Statistics Canada", visible: true },
  { id: "flood-risk", name: "Flood hazard zones", kind: "vector", source: "Alberta Open Data", visible: true }
];
const analyses: Analysis[] = [{ id: "emergency-coverage", name: "Emergency coverage study", status: "draft", createdAt: "Today" }];
const layout: PanelLayout = { left: 17, center: 58, right: 25, bottom: 23 };

interface WorkspaceStore {
  workspace: Workspace;
  datasets: Dataset[];
  analyses: Analysis[];
  timeline: TimelineState;
  planner: PlannerState;
  runtime: RuntimeState;
  setSection(section: NavigationSection): void;
  toggleSidebar(): void;
  setHorizontalLayout(layout: Pick<PanelLayout, "left" | "center" | "right">): void;
  setBottomSize(bottom: number): void;
  setTimelinePlaying(isPlaying: boolean): void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(persist((set) => ({
  workspace: { activeProject: project, activeSection: "projects", layout, isSidebarCollapsed: false },
  datasets, analyses,
  timeline: { progress: 0, isPlaying: false, steps: ["Intent", "Datasets", "Workflow", "Execution", "Result"].map((label, index) => ({ id: label.toLowerCase(), label, status: index === 0 ? "ready" : "pending" })) },
  planner: { status: "ready", notes: ["Planner is ready for a spatial objective.", "No workflow has been generated."] },
  runtime: { status: "ready", backend: "PyQGIS adapter (local)" },
  setSection: (activeSection) => set((state) => ({ workspace: { ...state.workspace, activeSection } })),
  toggleSidebar: () => set((state) => ({ workspace: { ...state.workspace, isSidebarCollapsed: !state.workspace.isSidebarCollapsed } })),
  setHorizontalLayout: (horizontal) => set((state) => ({ workspace: { ...state.workspace, layout: { ...state.workspace.layout, ...horizontal } } })),
  setBottomSize: (bottom) => set((state) => ({ workspace: { ...state.workspace, layout: { ...state.workspace.layout, bottom } } })),
  setTimelinePlaying: (isPlaying) => set((state) => ({ timeline: { ...state.timeline, isPlaying } }))
}), { name: "heka-workspace-shell", partialize: (state) => ({ workspace: state.workspace }) }));
