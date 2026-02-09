import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import "@shadcn/ui/styles.css";
import "./index.css";

import { routeTree } from "./routeTree.gen.ts";
import { DesktopEventProvider } from "./contexts/DesktopEventContext";
import { DesktopRealtimeProvider } from "./contexts/DesktopRealtimeContext";

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
        <DesktopRealtimeProvider>
          <RouterProvider router={router} />
        </DesktopRealtimeProvider>
      </DesktopEventProvider>
    </StrictMode>,
  );
}
