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
      const session = await getSession();
      const userData = getLocalUserData();

      if (session && userData.uid) {
        navigate({ to: "/home", replace: true });
      } else {
        navigate({ to: "/auth", replace: true });
      }
    };

    checkAuth();
  }, [navigate]);

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}
