import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
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
