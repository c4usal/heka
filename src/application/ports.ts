import type { DatasetRef, SpatialWorkflow } from "../domain/spatial";

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
