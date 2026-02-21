import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Toaster } from "@shadcn/ui/components/sonner.tsx";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppShell } from "../components/AppShell";
import supabase from "@lib/supabase/supabase";
import { isTauri } from "@lib/utils/platform";

const AUTH_ROUTES = ["/auth", "/verify", "/reset"];

const RootLayout = () => {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // Forward the Supabase JWT to the Rust backend so auth_client() can
  // make admin-privileged writes (schedule bootstrap, purge, shift assignments, etc.)
  useEffect(() => {
    if (!isTauri()) return;

    // Send existing session JWT immediately on mount, then trigger a sync.
    // trigger_sync_now MUST come after set_user_jwt resolves — the Rust sync
    // uses the JWT for all Supabase API calls, and child component effects
    // (DesktopCompetitionDataContext) fire trigger_sync_now before this
    // parent effect runs (React: children effects before parent effects).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        invoke("set_user_jwt", { jwt: session.access_token })
          .then(() => invoke("trigger_sync_now"))
          .catch(console.error);
        console.log("[Auth] Sent JWT to Rust backend on mount");
      }
    });

    // Keep JWT fresh on token refresh / re-login
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        invoke("set_user_jwt", { jwt: session.access_token }).catch(console.error);
        console.log("[Auth] Sent refreshed JWT to Rust backend");
      }
    });

    return () => subscription.unsubscribe();
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
