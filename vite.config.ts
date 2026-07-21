import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

declare const process: { env: Record<string, string | undefined> };

const useCesiumCdn = process.env.HEKA_CESIUM_CDN === "1";
const cesiumBase = useCesiumCdn
  ? "https://cdn.jsdelivr.net/npm/cesium@1.143.0/Build/Cesium/"
  : "/cesium/";

export default defineConfig({
  // Ship Cesium runtime assets under a clean bundle path for Tauri, or CDN for Cloudflare web.
  define: { CESIUM_BASE_URL: JSON.stringify(cesiumBase) },
  plugins: [
    react(),
    ...(useCesiumCdn
      ? []
      : [
          viteStaticCopy({
            targets: [
              { src: "node_modules/cesium/Build/Cesium/Workers", dest: "cesium", rename: { stripBase: 4 } },
              { src: "node_modules/cesium/Build/Cesium/ThirdParty", dest: "cesium", rename: { stripBase: 4 } },
              { src: "node_modules/cesium/Build/Cesium/Assets", dest: "cesium", rename: { stripBase: 4 } },
              { src: "node_modules/cesium/Build/Cesium/Widgets", dest: "cesium", rename: { stripBase: 4 } },
            ],
          }),
        ]),
  ],
  build: { chunkSizeWarningLimit: 5000 },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
});
