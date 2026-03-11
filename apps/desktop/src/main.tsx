import { StrictMode } from "react";
import ReactDOM from "react-dom/client";

// In production Tauri builds, pipe console output → tauri-plugin-log → log file on disk.
// This lets us read logs from ~/Library/Logs/funkyscout/ (macOS) or platform equivalent
// without needing DevTools, which aren't available in a signed .app bundle.
// In dev (http://localhost) this is skipped — browser DevTools console works fine.
//
// Top-level await ensures the override is in place BEFORE React renders so no early
// logs (e.g. "[DesktopRealtime] ✅ Realtime subscribed") are missed in the log file.
if (window.location.protocol === "tauri:") {
  const { info, warn, error } = await import("@tauri-apps/plugin-log");
  const fmt = (args: unknown[]) =>
    args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  const _log = console.log.bind(console);
  const _warn = console.warn.bind(console);
  const _error = console.error.bind(console);
  console.log = (...args) => { _log(...args); info(fmt(args)).catch(() => {}); };
  console.warn = (...args) => { _warn(...args); warn(fmt(args)).catch(() => {}); };
  console.error = (...args) => { _error(...args); error(fmt(args)).catch(() => {}); };
}
import { createRouter, RouterProvider } from "@tanstack/react-router";
import "@shadcn/ui/styles.css";
import "./index.css";

import { routeTree } from "./routeTree.gen.ts";
import { DesktopEventProvider } from "./contexts/DesktopEventContext";
import { DesktopSyncProvider } from "./contexts/DesktopSyncContext";
import { DesktopRealtimeProvider } from "./contexts/DesktopRealtimeContext";
import { DesktopTeamDataProvider } from "./contexts/DesktopTeamDataContext";
import { DesktopCompetitionDataProvider } from "./contexts/DesktopCompetitionDataContext";
import { UserProfilesProvider } from "./contexts/UserProfilesContext";
import { TabProvider } from "./contexts/TabContext";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Render the app
const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <DesktopEventProvider>
        <DesktopSyncProvider>
          <DesktopRealtimeProvider>
            <DesktopTeamDataProvider>
              <DesktopCompetitionDataProvider>
                <UserProfilesProvider>
                  <TabProvider router={router}>
                    <RouterProvider router={router} />
                  </TabProvider>
                </UserProfilesProvider>
              </DesktopCompetitionDataProvider>
            </DesktopTeamDataProvider>
          </DesktopRealtimeProvider>
        </DesktopSyncProvider>
      </DesktopEventProvider>
    </StrictMode>,
  );
}
