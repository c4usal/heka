import { invoke } from "@tauri-apps/api/core";
import type { ExecutionResult } from "../types/workspace";
import type { PlannerPlan } from "../types/workspace";

export type ExecutionProgress = { stage: string; percent: number; detail: string };
type RuntimeHealth = { available: boolean; backend: string; detail: string };

export async function checkPyQgisRuntime(): Promise<RuntimeHealth> {
  if (!("__TAURI_INTERNALS__" in window)) return { available: false, backend: "PyQGIS / QGIS Processing", detail: "Desktop runtime required" };
  return invoke<RuntimeHealth>("runtime_health");
}

export async function executeSpatialPlan(plan: PlannerPlan): Promise<ExecutionResult> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("PyQGIS execution requires the Heka desktop application. Run this analysis from Tauri after QGIS LTR is installed.");
  return invoke<ExecutionResult>("execute_spatial_plan", { request: { plan } });
}
