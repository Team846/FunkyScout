import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@shadcn/ui/components/button.tsx";

const PRACTICE_MATCH = "qm99";
const PRACTICE_TEAM = "frc9999";

export const Route = createFileRoute("/practice")({
  component: PracticePage,
});

function PracticePage() {
  const navigate = useNavigate();

  const startPractice = (alliance: "red" | "blue") => {
    navigate({
      to: "/match_start",
      search: {
        teamNum: PRACTICE_TEAM,
        matchNum: PRACTICE_MATCH,
        alliance,
        practice: true,
      },
    });
  };

  return (
    <div className="min-h-dvh w-full bg-background flex flex-col items-center justify-center gap-6 p-6">
      <p className="text-muted-foreground text-center">
        Practice the full match flow locally. No login required. Data stays on your device.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-xs">
        <Button
          variant="outline"
          className="flex-1 h-24 border-2 border-[#B73E3E] hover:bg-[#B73E3E]/20 text-[#B73E3E]"
          onClick={() => startPractice("red")}
        >
          Red Alliance
        </Button>
        <Button
          variant="outline"
          className="flex-1 h-24 border-2 border-[#246190] hover:bg-[#246190]/20 text-[#246190]"
          onClick={() => startPractice("blue")}
        >
          Blue Alliance
        </Button>
      </div>
      <Button
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => navigate({ to: "/auth" })}
      >
        Back to sign in
      </Button>
    </div>
  );
}
