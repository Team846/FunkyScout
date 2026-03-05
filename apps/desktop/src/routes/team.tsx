import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { useTabContext } from "../contexts/TabContext";
import { ExpandedTeamPanel } from "../components/TeamPanelShared";

export const Route = createFileRoute("/team")({
  component: TeamPage,
  validateSearch: (search: Record<string, unknown>) => ({
    team: (search.team as string) || "",
  }),
});

function TeamPage() {
  const { closeTab } = useTabContext();
  const { team: teamKey } = Route.useSearch();
  const { tbaTeams, pitScoutingData } = useDesktopTeamData();
  const { matchScoutingData, tbaClimbData } = useDesktopCompetitionData();

  const tbaTeam = tbaTeams.find((t) => t.key === teamKey);
  const pitScouting = pitScoutingData.find((p) => p.team === teamKey);
  const teamMatchData = matchScoutingData.filter((m) => m.team === teamKey);

  const handleBack = useCallback(() => {
    closeTab(`team-${teamKey}`);
  }, [closeTab, teamKey]);

  return (
    <ExpandedTeamPanel
      teamKey={teamKey}
      tbaTeam={tbaTeam}
      matchData={teamMatchData}
      allMatchData={matchScoutingData}
      pitScouting={pitScouting}
      tbaClimbData={tbaClimbData}
      useTbaClimb={true}
      allTbaTeams={tbaTeams}
      onClose={handleBack}
    />
  );
}
