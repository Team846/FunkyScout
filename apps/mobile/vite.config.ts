import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const plugins: PluginOption[] = [
  TanStackRouterVite({
    target: "react",
    autoCodeSplitting: false,
    routesDirectory: "./src/routes",
    generatedRouteTree: "./src/routeTree.gen.ts",
    quoteStyle: "double",
    enableRouteGeneration: true,
  }) as unknown as PluginOption,
  react({
    babel: {
      plugins: [["babel-plugin-react-compiler"]],
    },
  }),
  tailwindcss() as unknown as PluginOption,
  VitePWA({
    registerType: "autoUpdate",
    injectRegister: "auto",
    // Use a custom service worker so we can inject COOP/COEP headers onto
    // cached HTML responses — enabling SharedArrayBuffer (SQLite WASM/OPFS)
    // when the app launches from the home screen while offline.
    strategies: "injectManifest",
    srcDir: "src",
    filename: "sw.ts",
    manifest: {
      name: "FunkyScout",
      short_name: "FunkyScout",
      description: "FRC Scouting App",
      theme_color: "#000000",
      background_color: "#000000",
      display: "standalone",
      orientation: "portrait",
      start_url: "/",
      scope: "/",
      icons: [
        {
          src: "icon-180.png",
          sizes: "180x180",
          type: "image/png",
        },
        {
          src: "icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
        {
          src: "icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
      ],
    },
    injectManifest: {
      // Pre-cache JS/CSS/font/SVG/WASM bundles AND index.html.
      // HTML must be pre-cached so the app can launch offline on first install.
      // WASM and SQLite worker JS must also be pre-cached so SQLite can init
      // offline (they do NOT require COOP/COEP headers — only the HTML page does).
      globPatterns: ["**/*.{js,css,woff2,ttf,svg,html,wasm}"],
    },
  }),
];

export default defineConfig({
  plugins,
  // Use shared .env from workspace root
  envDir: path.resolve(__dirname, "../.."),
  server: {
    port: 5713,
    // Required headers for SQLite WASM with OPFS (SharedArrayBuffer)
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    // Exclude SQLite WASM from optimization (it has its own WASM loading)
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  resolve: {
    alias: {
      // For shadcn internal imports like @/lib/utils
      "@": path.resolve(__dirname, "../../packages/shadcn/src"),
      // For our lib folder
      "@lib": path.resolve(__dirname, "../../lib"),
    },
  },
});
