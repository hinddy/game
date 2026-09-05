import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // wasm-bindgen keeps a JS heap next to the WASM instance. Pre-bundling can
    // duplicate that bridge in dev and invalidate handles returned by Rapier.
    exclude: ["@dimforge/rapier3d"],
  },
  build: {
    target: "es2022",
    // Keep binary assets out of JavaScript and keep immutable hashed chunks
    // independently cacheable by the eventual CDN/service worker.
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    manifest: true,
    sourcemap: false,
    chunkSizeWarningLimit: 360,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@dimforge/rapier3d")) return "rapier";
          if (id.includes("node_modules/three")) return "three";
          return undefined;
        },
      },
    },
  },
});
