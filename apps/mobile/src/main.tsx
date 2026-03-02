import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { EventProvider } from "@lib/context/EventContext";
import { SyncProvider } from "@lib/context/SyncContext";
import { PitScoutFormProvider } from "@lib/context/PitScoutFormContext";
import { TeamDataProvider } from "@lib/context/TeamDataContext";
import { CompetitionDataProvider } from "@lib/context/CompetitionDataContext";
import { AnalyticsDataProvider } from "@lib/context/AnalyticsDataContext";
import "@shadcn/ui/styles.css";

import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// When a new service worker activates via skipWaiting() + clients.claim(), reload the page
// so the new JS bundles take effect. VitePWA's autoUpdate waits for state==='installed'
// which skipWaiting() bypasses — this controllerchange listener is the correct hook.
if ("serviceWorker" in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

// Render the app
const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <EventProvider>
        <SyncProvider router={router}>
          <PitScoutFormProvider>
            <TeamDataProvider>
              <CompetitionDataProvider>
                <AnalyticsDataProvider>
                  <RouterProvider router={router} />
                </AnalyticsDataProvider>
              </CompetitionDataProvider>
            </TeamDataProvider>
          </PitScoutFormProvider>
        </SyncProvider>
      </EventProvider>
    </StrictMode>,
  );
}
