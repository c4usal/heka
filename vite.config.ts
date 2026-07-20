import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
  plugins: [react(), viteStaticCopy({ targets: [
    { src: "node_modules/cesium/Build/Cesium/Workers", dest: "cesium" },
    { src: "node_modules/cesium/Build/Cesium/ThirdParty", dest: "cesium" },
    { src: "node_modules/cesium/Build/Cesium/Assets", dest: "cesium" },
    { src: "node_modules/cesium/Build/Cesium/Widgets", dest: "cesium" }
  ] })],
  // Cesium ships as a single rendering engine; splitting it breaks worker/asset resolution.
  build: { chunkSizeWarningLimit: 5000 },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"]
});
