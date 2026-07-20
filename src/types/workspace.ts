export type NavigationSection = "projects" | "datasets" | "layers" | "history" | "plugins";

export interface Project { id: string; name: string; path: string; updatedAt: string; }
export interface Dataset { id: string; name: string; kind: "vector" | "raster" | "network"; source: string; visible: boolean; }
export interface Analysis { id: string; name: string; status: "draft" | "ready" | "running" | "complete"; createdAt: string; }
export interface TimelineState { progress: number; isPlaying: boolean; steps: Array<{ id: string; label: string; status: "pending" | "ready" | "complete" }>; }
export interface PlannerState { status: "idle" | "ready" | "planning"; notes: string[]; }
export interface RuntimeState { status: "offline" | "ready" | "running"; backend: string; }
export interface PanelLayout { left: number; center: number; right: number; bottom: number; }
export interface Workspace { activeProject: Project; activeSection: NavigationSection; layout: PanelLayout; isSidebarCollapsed: boolean; }
