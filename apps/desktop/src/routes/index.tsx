import { createFileRoute, redirect } from "@tanstack/react-router";
import supabase from "@lib/supabase/supabase";
import { getLocalUserData } from "@lib/supabase/user";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    // Fast offline-first check: getLocalUserData() reads localStorage synchronously
    // and never blocks. supabase.auth.getSession() can hang for ~50 seconds offline
    // when the access token is expired (auth-js retries the refresh 8+ times with
    // exponential backoff). The session is never deleted on failed offline refresh,
    // so local user data is a reliable signal that the user is logged in.
    const userData = getLocalUserData();
    if (userData.uid) {
      throw redirect({ to: "/dashboard" });
    }

    // No local user data — full session check (first install or post-logout).
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      throw redirect({ to: "/auth" });
    }

    throw redirect({ to: "/dashboard" });
  },
});
