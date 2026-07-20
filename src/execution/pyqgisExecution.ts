import { invoke } from "@tauri-apps/api/core";
import type { ExecutionResult } from "../types/workspace";

export type ExecutionProgress = { stage: string; percent: number; detail: string };
export async function executeFireStationAnalysis(): Promise<ExecutionResult> {
  if (!("__TAURI_INTERNALS__" in window)) throw new Error("PyQGIS execution requires the Heka desktop application. Run this analysis from Tauri after QGIS LTR is installed.");
  return invoke<ExecutionResult>("execute_fire_station_analysis", { request: {} });
}
