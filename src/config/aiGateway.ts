/** Public Cloudflare endpoints for the browser build (judges / web). */
export const hostedPlannerGatewayUrl = "https://heka-ai-gateway.ulofeuduokhai.workers.dev";
export const hostedEarthApiUrl = "https://heka-web.ulofeuduokhai.workers.dev";

/** Same-origin when served from heka-web; Tauri / local Vite use hosted Earth Agent. */
export function earthApiBaseUrl(): string {
  const configured = import.meta.env.VITE_HEKA_EARTH_API_URL as string | undefined;
  if (configured?.trim()) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
    // Served from heka-web Worker → same-origin /api/*
    if (window.location.hostname.includes("workers.dev") || window.location.hostname === "localhost") {
      return "";
    }
  }
  return hostedEarthApiUrl;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isWebRuntime(): boolean {
  return !isTauriRuntime();
}
