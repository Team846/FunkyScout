import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { getSession } from "@lib/supabase/auth";
import { getLocalUserData } from "@lib/supabase/user";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      // Fast offline-first check: getLocalUserData() is a synchronous localStorage
      // read and returns immediately. This avoids the 50-second hang that
      // supabase.auth.getSession() causes offline when the access token is expired
      // (auth-js retries the refresh 8+ times with exponential backoff before giving up).
      // The session is never deleted on failed offline refresh — it's kept and retried
      // later — so checking local user data is sufficient to detect a logged-in user.
      const userData = getLocalUserData();

      if (userData.uid) {
        // User has local data from a previous login — proceed immediately.
        // getSession() is still called in the background by the auth client's
        // autoRefreshToken timer; we don't need to block on it here.
        const savedEvent = localStorage.getItem("current_event");
        navigate({ to: savedEvent ? "/home" : "/events", replace: true });
        return;
      }

      // No local user data — need a full session check (first install or post-logout).
      const session = await getSession();
      if (session) {
        const savedEvent = localStorage.getItem("current_event");
        navigate({ to: savedEvent ? "/home" : "/events", replace: true });
      } else {
        navigate({ to: "/auth", replace: true });
      }
    };

    checkAuth();
  }, [navigate]);

  return (
    <div className="min-h-dvh w-full bg-background flex items-center justify-center">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}
