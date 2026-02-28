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
          src: "icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any",
        },
      ],
    },
    workbox: {
      // Pre-cache JS/CSS/font bundles AND static SVG assets.
      // SVGs (red_field.svg, blue_field.svg) must be pre-cached so the field
      // images are available offline immediately, without requiring a prior
      // online visit to each page. HTML is intentionally excluded — it must
      // come from the network for COOP/COEP headers (SharedArrayBuffer/WASM).
      globPatterns: ["**/*.{js,css,woff2,ttf,svg}"],
      // Exclude WASM and SQLite worker files — they rely on special
      // response headers and must not be served from SW cache
      globIgnores: ["**/*.wasm", "**/sqlite*.js", "**/sqlite3*.js"],
      // Never intercept navigation — HTML must come from Vercel
      // so SharedArrayBuffer headers are present
      navigateFallback: null,
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
