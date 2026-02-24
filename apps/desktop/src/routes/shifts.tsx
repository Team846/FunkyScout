import { createFileRoute } from "@tanstack/react-router";
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { Card } from "@shadcn/ui/components/card.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@shadcn/ui/components/tabs.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import {
  buildScouterViewData,
  buildTeamViewData,
  type ScouterViewRow,
  type TeamViewRow,
  type MatchCard,
} from "@lib/data/shiftViews";
import { setScouterRating } from "@lib/data/scouterRatings";
import {
  getMatchScoutingData,
  getPitScoutingData,
  getUserProfiles,
  type MatchScoutingData,
  type PitScoutingData,
  type UserProfile,
} from "../lib/db";
import { setTeamPriority } from "@lib/data/writes";

export const Route = createFileRoute("/shifts")({
  component: ShiftViewerPage,
});

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex gap-0">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`text-sm px-0.5 transition-colors leading-none ${
            value != null && n <= value
              ? "text-yellow-400"
              : "text-muted-foreground/25"
          } hover:text-yellow-300`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function ClimbBadge({
  wasScouted,
  scouted,
  tba,
  climbMatch,
}: {
  wasScouted: boolean | undefined;
  scouted: "L1" | "L2" | "L3" | null | undefined;
  tba: "L1" | "L2" | "L3" | null | undefined;
  climbMatch: boolean | null | undefined;
}) {
  if (!wasScouted) {
    return <span className="text-[10px] text-muted-foreground/40">—</span>;
  }
  if (climbMatch === null || climbMatch === undefined) {
    return <span className="text-[10px] text-muted-foreground/40">no TBA</span>;
  }
  return (
    <span
      className={`text-[10px] font-medium leading-none ${
        climbMatch ? "text-green-500" : "text-red-400"
      }`}
    >
      {climbMatch
        ? scouted != null ? `${scouted} ✓` : "no climb ✓"
        : `${scouted ?? "none"} ≠ ${tba ?? "none"}`}
    </span>
  );
}

function formatMatchTime(estTime: number | null): string | null {
  if (!estTime) return null;
  const date = new Date(estTime * 1000);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function MatchCardSmall({
  card,
  type,
}: {
  card: MatchCard;
  type: "scouter-past" | "scouter-next" | "team-past" | "team-next";
}) {
  const allianceBorder =
    card.alliance === "red"
      ? "border-red-500/40 bg-red-500/10"
      : "border-blue-500/40 bg-blue-500/10";
  const isTeam = type === "team-past" || type === "team-next";
  const matchTime = formatMatchTime(card.estTime);

  return (
    <div
      className={`w-[180px] flex-shrink-0 border rounded-lg px-3 py-3 flex items-stretch gap-0 ${allianceBorder}`}
    >
      {/* Left side: centered vertically */}
      <div className="flex flex-1 flex-col items-center justify-center gap-1 pr-2 min-w-0">
        <span className="font-semibold text-base">{card.matchDisplay}</span>

        {!isTeam && (
          <span className="text-sm text-primary leading-none">
            {card.teamNumber}
          </span>
        )}

        {type === "team-past" && (
          <>
            {card.redScore != null && (
              <div className="text-sm leading-none font-medium">
                <span className="text-red-400">{card.redScore}</span>
                <span className="text-muted-foreground/50"> - </span>
                <span className="text-blue-400">{card.blueScore}</span>
              </div>
            )}
            <div
              className={`text-xs leading-snug truncate ${
                card.wasScouted ? "text-primary" : "text-muted-foreground/70"
              }`}
            >
              {card.wasScouted
                ? card.scoutedByName ?? "Scouted"
                : "Not scouted"}
            </div>
          </>
        )}

        {type === "team-next" && card.predictedRedScore != null && (
          <div className="text-sm leading-none font-medium">
            <span className="text-red-400/70">~{Math.round(card.predictedRedScore)}</span>
            <span className="text-muted-foreground/50"> - </span>
            <span className="text-blue-400/70">~{Math.round(card.predictedBlueScore ?? 0)}</span>
          </div>
        )}
      </div>

      {/* Vertical divider */}
      <div className="w-px bg-border shrink-0" />

      {/* Right side: left-aligned, close to divider */}
      <div className="flex flex-1 flex-col items-start justify-center gap-1 pl-2 min-w-0">
        {matchTime ? (
          <span className="text-xs text-muted-foreground/60">{matchTime}</span>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}

        {type === "scouter-past" && (
          <ClimbBadge
            wasScouted={card.wasScouted}
            scouted={card.scoutedClimbLevel}
            tba={card.tbaClimbLevel}
            climbMatch={card.climbMatch}
          />
        )}

        {type === "team-past" && (
          <ClimbBadge
            wasScouted={card.wasScouted}
            scouted={card.scoutedClimbLevel}
            tba={card.tbaClimbLevel}
            climbMatch={card.climbMatch}
          />
        )}

        {type === "team-next" && (
          <div
            className={`text-xs leading-snug truncate text-right ${
              card.assignedScouterName ? "text-primary" : "text-muted-foreground/70"
            }`}
          >
            {card.assignedScouterName ?? "No one assigned"}
          </div>
        )}
      </div>
    </div>
  );
}

function MatchCardScroll({
  cards,
  type,
  alignRight,
}: {
  cards: MatchCard[];
  type: "scouter-past" | "scouter-next" | "team-past" | "team-next";
  alignRight?: boolean;
}) {
  return (
    <div className="flex flex-1 min-w-[80vw] items-center">
      <div
        className={`flex gap-3.5 overflow-x-auto items-center py-1 ${
          alignRight ? "ml-auto flex-row" : ""
        }`}
      >
        {cards.length === 0 ? (
          <div className="text-sm text-muted-foreground/30 px-2">—</div>
        ) : (
          cards.map((m) => (
            <MatchCardSmall
              key={`${m.matchKey}-${m.team}`}
              card={m}
              type={type}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Center card — scouter
function ScouterCard({
  row,
  rating,
  onRatingChange,
}: {
  row: ScouterViewRow;
  rating: number | null;
  onRatingChange: (n: number) => void;
}) {
  return (
    <Card className="w-[220px] flex-shrink-0 px-4 py-3 flex flex-col gap-1.5">
      {/* Row 1: name + stars */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="font-semibold text-base truncate flex-1">{row.name}</span>
        <StarRating value={rating} onChange={onRatingChange} />
      </div>
      {/* Row 2: stats */}
      <div className="text-xs text-muted-foreground leading-snug">
        {row.matchesScouted}/{row.matchesAssigned} scouted
        {row.climbAccuracy != null && ` · ${row.climbAccuracy.toFixed(0)}% accuracy`}
      </div>
    </Card>
  );
}

// Center card — team
function TeamCard({
  row,
  priority,
  onPriorityChange,
}: {
  row: TeamViewRow;
  priority: number | null;
  onPriorityChange: (n: number) => void;
}) {
  return (
    <Card className="w-[220px] flex-shrink-0 px-4 py-3 flex flex-col gap-1.5">
      {/* Row 1: team number + name */}
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-bold text-base flex-shrink-0">{row.teamNumber}</span>
        <span className="text-xs text-muted-foreground truncate">{row.teamName}</span>
      </div>
      {/* Row 2: EPA + scouted */}
      <div className="text-xs text-muted-foreground leading-snug">
        {row.matchesScouted}/{row.matchesAssigned} scouted
        {row.epa != null && ` · EPA ${row.epa.toFixed(1)}`}
      </div>
      {/* Row 3: priority stars */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Priority</span>
        <StarRating value={priority} onChange={onPriorityChange} />
      </div>
    </Card>
  );
}

function ScouterRow({
  row,
  rating,
  onRatingChange,
}: {
  row: ScouterViewRow;
  rating: number | null;
  onRatingChange: (uid: string, n: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-6 p-2.5">
      <MatchCardScroll cards={row.pastMatches} type="scouter-past" alignRight />
      <ScouterCard
        row={row}
        rating={rating}
        onRatingChange={(n) => onRatingChange(row.uid, n)}
      />
      <MatchCardScroll cards={row.nextMatches} type="scouter-next" />
  </div>
  );
}

function TeamRow({
  row,
  priority,
  onPriorityChange,
}: {
  row: TeamViewRow;
  priority: number | null;
  onPriorityChange: (teamKey: string, n: number) => void;
}) {
  return (
    <div className="flex items-center gap-6">
      <MatchCardScroll cards={row.pastMatches} type="team-past" alignRight />
      <TeamCard
        row={row}
        priority={priority}
        onPriorityChange={(n) => onPriorityChange(row.teamKey, n)}
      />
      <MatchCardScroll cards={row.nextMatches} type="team-next" />
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-center py-10 text-muted-foreground text-sm">
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ShiftViewerPage() {
  const { currentEvent } = useDesktopEvent();
  const { schedule, tbaClimbData, lastDataRefreshAt } =
    useDesktopCompetitionData();
  const { tbaTeams } = useDesktopTeamData();

  const [matchData, setMatchData] = useState<MatchScoutingData[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [pitData, setPitData] = useState<PitScoutingData[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const [scouterSearch, setScouterSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");

  // Pending changes — lifted from individual rows so one Save covers everything
  const [dirtyRatings, setDirtyRatings] = useState<Record<string, number>>({});
  const [dirtyPriorities, setDirtyPriorities] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // Load per-event data from local SQLite; refresh on every sync cycle.
  // Only shows spinner on first load — background refreshes update silently.
  useEffect(() => {
    if (!currentEvent) return;
    if (!hasLoadedRef.current) setLoading(true);
    Promise.all([
      getMatchScoutingData(currentEvent),
      getPitScoutingData(currentEvent),
      getUserProfiles(),
    ])
      .then(([md, pd, prof]) => {
        setMatchData(md);
        setPitData(pd);
        setProfiles(prof);
      })
      .catch((e) => console.error("[Shifts] Failed to load data:", e))
      .finally(() => {
        hasLoadedRef.current = true;
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEvent, lastDataRefreshAt]);

  // Clear dirty state and reset load flag when event changes
  useEffect(() => {
    hasLoadedRef.current = false;
    setDirtyRatings({});
    setDirtyPriorities({});
  }, [currentEvent]);

  const scouterRows = useMemo(
    () => buildScouterViewData({ schedule, matchData, profiles, tbaClimbData }),
    [schedule, matchData, profiles, tbaClimbData]
  );

  const teamRows = useMemo(
    () => buildTeamViewData({ schedule, matchData, tbaTeams, pitData, tbaClimbData }),
    [schedule, matchData, tbaTeams, pitData, tbaClimbData]
  );

  const filteredScouters = useMemo(
    () =>
      scouterRows.filter((s) => {
        if (s.matchesScouted === 0) return false;
        if (scouterSearch) {
          return s.name
            .toLowerCase()
            .includes(scouterSearch.toLowerCase());
        }

        return true;
      }),
    [scouterRows, scouterSearch]
  );


  const filteredTeams = useMemo(
    () =>
      teamSearch
        ? teamRows.filter(
            (t) =>
              t.teamNumber.toString().includes(teamSearch) ||
              t.teamName.toLowerCase().includes(teamSearch.toLowerCase())
          )
        : teamRows,
    [teamRows, teamSearch]
  );

  const handleRatingChange = useCallback((uid: string, n: number) => {
    setDirtyRatings((prev) => ({ ...prev, [uid]: n }));
  }, []);

  const handlePriorityChange = useCallback((teamKey: string, n: number) => {
    setDirtyPriorities((prev) => ({ ...prev, [teamKey]: n }));
  }, []);

  const handleSaveAll = useCallback(async () => {
    if (!currentEvent) return;
    setSaving(true);
    try {
      await Promise.all([
        ...Object.entries(dirtyRatings).map(([uid, r]) => setScouterRating(uid, r)),
        ...Object.entries(dirtyPriorities).map(([teamKey, p]) =>
          setTeamPriority(currentEvent, teamKey, p)
        ),
      ]);
      setDirtyRatings({});
      setDirtyPriorities({});
      // Re-read from local SQLite so the UI reflects saved values immediately
      // (without waiting for the next 120s Rust sync cycle)
      const [pd, prof] = await Promise.all([
        getPitScoutingData(currentEvent),
        getUserProfiles(),
      ]);
      setPitData(pd);
      setProfiles(prof);
    } catch (e) {
      console.error("[Shifts] Save failed:", e);
    } finally {
      setSaving(false);
    }
  }, [currentEvent, dirtyRatings, dirtyPriorities]);

  const handleReset = useCallback(() => {
    setDirtyRatings({});
    setDirtyPriorities({});
  }, []);

  const hasScouterChanges = Object.keys(dirtyRatings).length > 0;
  const hasTeamChanges = Object.keys(dirtyPriorities).length > 0;

  if (!currentEvent) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          Please select an event to view shifts.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-y-auto overflow-x-hidden">
      <Tabs defaultValue="by-scouter" className="w-full">
        <TabsList>
          <TabsTrigger value="by-scouter">By Scouter</TabsTrigger>
          <TabsTrigger value="by-team">By Team</TabsTrigger>
        </TabsList>

        {/* ── By Scouter ── */}
        <TabsContent value="by-scouter" className="mt-3 space-y-3">
          {/* Toolbar: search + save/reset */}
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search scouters…"
              value={scouterSearch}
              onChange={(e) => setScouterSearch(e.target.value)}
              className="w-52 h-8 text-sm"
            />
            {hasScouterChanges && (
              <>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={saving}
                  onClick={handleSaveAll}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={saving}
                  onClick={handleReset}
                >
                  Reset
                </Button>
              </>
            )}
          </div>

          {loading ? (
            <EmptyState>Loading…</EmptyState>
          ) : filteredScouters.length === 0 ? (
            <EmptyState>
              {scouterSearch
                ? "No scouters match the search"
                : "No scouters assigned or scouting data found"}
            </EmptyState>
          ) : (
            <div className="flex-1 flex-col gap-2.5 space-y-6 w-full p-2.5">
              {filteredScouters.map((s) => (
                <ScouterRow
                  key={s.uid}
                  row={s}
                  rating={dirtyRatings[s.uid] ?? s.rating}
                  onRatingChange={handleRatingChange}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── By Team ── */}
        <TabsContent value="by-team" className="mt-3 space-y-3">
          {/* Toolbar: search + save/reset */}
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search teams…"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              className="w-52 h-8 text-sm"
            />
            {hasTeamChanges && (
              <>
                <Button
                  size="sm"
                  className="h-8"
                  disabled={saving}
                  onClick={handleSaveAll}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={saving}
                  onClick={handleReset}
                >
                  Reset
                </Button>
              </>
            )}
          </div>

          {loading ? (
            <EmptyState>Loading…</EmptyState>
          ) : filteredTeams.length === 0 ? (
            <EmptyState>
              {teamSearch
                ? "No teams match the search"
                : "No teams in the schedule"}
            </EmptyState>
          ) : (
            <div className="space-y-6">
              {filteredTeams.map((t) => (
                <TeamRow
                  key={t.teamKey}
                  row={t}
                  priority={dirtyPriorities[t.teamKey] ?? t.priority}
                  onPriorityChange={handlePriorityChange}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
