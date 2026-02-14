import { useCompetition } from "@lib/context/CompetitionDataContext";
import { getLocalUserData } from "@lib/supabase/user";
import { useEvent } from "@lib/context/EventContext";
export function ScoutingPage() {
  const { tbaSchedule } = useCompetition();
  const userData = getLocalUserData();
  const { currentEvent } = useEvent();



  return (
    <div className="flex min-h-[60vh] items-center justify-center rounded-2xl bg-yellow-400 p-6">
      <div className="text-center">
        <p className="text-xl font-semibold text-black">Scouting Page</p>
      </div>
    </div>
  );
}