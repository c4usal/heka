import type { AnalysisIntent, DatasetRef, SpatialReasoningGraph, SpatialWorkflow } from "../domain/spatial";

export interface PlannerPort {
  plan(question: string, datasets: DatasetRef[]): Promise<{ intent: AnalysisIntent; graph: SpatialReasoningGraph; workflow: SpatialWorkflow }>;
}

export interface RuntimeEvent {
  workflowId: string;
  stage: "validation" | "compilation" | "execution" | "visualization" | "complete" | "failed";
  label: string;
  progress: number;
  timestamp: string;
}

export interface SpatialRuntimePort {
  validate(workflow: SpatialWorkflow, datasets: DatasetRef[]): Promise<{ valid: boolean; errors: string[] }>;
  execute(workflow: SpatialWorkflow, onEvent: (event: RuntimeEvent) => void): Promise<void>;
}
