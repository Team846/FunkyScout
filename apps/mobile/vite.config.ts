import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: false,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      quoteStyle: "double",
      enableRouteGeneration: true,
    }),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    tailwindcss(),
  ],
  // Use shared .env from workspace root
  envDir: path.resolve(__dirname, "../.."),
  server: {
    port: 5713,
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
