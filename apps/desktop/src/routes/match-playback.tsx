import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/match-playback")({
  component: MatchPlaybackRedirect,
  validateSearch: (search: Record<string, unknown>) => ({
    match: (search.match as string) || "",
  }),
});

function MatchPlaybackRedirect() {
  const navigate = useNavigate();
  const { match } = Route.useSearch();

  useEffect(() => {
    navigate({ to: "/matches", search: { match: match || "" } });
  }, [navigate, match]);

  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      Redirecting to matches...
    </div>
  );
}
