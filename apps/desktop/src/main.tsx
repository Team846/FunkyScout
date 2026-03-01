import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
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
