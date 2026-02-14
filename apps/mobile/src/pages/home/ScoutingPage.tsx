import { useCompetition } from "@lib/context/CompetitionDataContext";
import { getLocalUserData } from "@lib/supabase/user";
import { useEvent } from "@lib/context/EventContext";
export function ScoutingPage() {
  const { tbaSchedule } = useCompetition();
  const userData = getLocalUserData();
  const { currentEvent } = useEvent();


  
  const matchKey = 'qm1'; // example match key
  const redScore = tbaSchedule[matchKey]?.redScore;
  //const redScore = 97;
  const userRedScore = 100;

  // Calculate accuracy (handle null/undefined cases)
  const accuracy = redScore && userRedScore
    ? redScore > userRedScore 
      ? (userRedScore / redScore) * 100
      : (redScore / userRedScore) * 100
    : null;

  return (
    <div className="flex min-h-[60vh] items-center justify-center rounded-2xl bg-yellow-400 p-6">
      <div className="text-center">
        <p className="text-xl font-semibold text-black">Scouting Page</p>
        <p className="text-black">
          Your accuracy: {accuracy !== null ? `${accuracy.toFixed(1)}%` : 'N/A'}
        </p>
        <p className="text-sm text-black/70">
          Red Score: {redScore ?? 'Not available'} | Your Score: {userRedScore}
        </p>
      </div>
    </div>
  );
}