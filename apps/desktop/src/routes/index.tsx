import { createFileRoute, redirect } from "@tanstack/react-router";
import supabase from "@lib/supabase/supabase";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    // Check if user is authenticated
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      // Not logged in - redirect to auth
      throw redirect({ to: "/auth" });
    }

    // Logged in - redirect to dashboard
    throw redirect({ to: "/dashboard" });
  },
});
