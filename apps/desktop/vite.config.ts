import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// //@ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const shadcnpath = path.resolve(__dirname, "../../packages/shadcn/src");
console.log("Shadcn path resolves to:", shadcnpath);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tanstackRouter({
    target: "react",
    autoCodeSplitting: true,
  }), react(), tailwindcss()],
  resolve: {
    alias: {
      "@ui": path.resolve(__dirname, "../../packages/shadcn/src"),
      "@": path.resolve(__dirname, "../../packages/shadcn/src"),
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
