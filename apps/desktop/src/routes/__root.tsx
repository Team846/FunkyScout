import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@shadcn/ui/components/sonner.tsx";
import { useEffect } from "react";
import { AppShell } from "../components/AppShell";

const AUTH_ROUTES = ["/auth", "/verify", "/reset"];

const RootLayout = () => {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  return (
    <>
      {isAuthRoute ? (
        <Outlet />
      ) : (
        <AppShell>
          <Outlet />
        </AppShell>
      )}
      <Toaster position="top-center" />
      <TanStackRouterDevtools />
    </>
  );
};

export const Route = createRootRoute({ component: RootLayout });
