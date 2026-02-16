import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Badge } from "@shadcn/ui/components/badge.tsx";
import { Switch } from "@shadcn/ui/components/switch.tsx";
import { useEvent } from "@lib/context/EventContext";
import { useTeamData } from "@lib/context/TeamDataContext";
import { useCompetition } from "@lib/context/CompetitionDataContext";
import { getPicklistById } from "@lib/db";
import { updatePicklist, deletePicklist } from "@lib/data/writes";
import { canEditPicklist, canViewPicklist } from "@lib/utils/permissions";
import { getLocalUserData } from "@lib/supabase/user";
import type { EventPicklist, EventPicklistEntry } from "@lib/db";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type PicklistSearch = {
  id: string;
};

export const Route = createFileRoute("/picklist-view")({
  component: PicklistViewPage,
  validateSearch: (search: Record<string, unknown>): PicklistSearch => {
    return {
      id: (search.id as string) || "",
    };
  },
});

function PicklistViewPage() {
  const navigate = useNavigate();
  const { id } = Route.useSearch();
  const { currentEvent } = useEvent();
  const userData = getLocalUserData();
  const { teams } = useTeamData();
  const { refresh: refreshCompetition } = useCompetition();
  const [picklist, setPicklist] = useState<EventPicklist | null>(null);
  const [entries, setEntries] = useState<EventPicklistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [excludedToBottom, setExcludedToBottom] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [realtimeRefreshTrigger, setRealtimeRefreshTrigger] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Load picklist data (triggers context refresh, then reads from cache)
  const loadPicklistData = async () => {
    if (!currentEvent || !id) return;

    // Only show full-screen loader on initial load, not on refreshes
    const isInitialLoad = initialLoading;
    if (isInitialLoad) {
      setLoading(true);
    }

    try {
      console.log("[picklist-view] Triggering competition data refresh");

      // Step 1: Trigger CompetitionDataContext to refresh cache from Supabase
      await refreshCompetition();

      // Step 2: Read from freshly updated cache
      const { picklist, entries } = await getPicklistById(currentEvent, id);
      console.log("[picklist-view] Loaded picklist from cache:", picklist);
      setPicklist(picklist);
      setEntries(entries);
    } catch (error) {
      console.error("Failed to load picklist:", error);
      if (isInitialLoad) {
        toast.error("Failed to load picklist");
      }
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    loadPicklistData();
  }, [currentEvent, id, realtimeRefreshTrigger]);

  // Polling updates (15 second interval for picklists and assignments)
  useEffect(() => {
    if (!currentEvent || !id) return;

    console.log(`[picklist-view] 🔄 Setting up 15s polling for picklist ${id}`);

    const interval = setInterval(() => {
      console.log("[picklist-view] 🔄 Polling refresh triggered");
      setRealtimeRefreshTrigger(prev => prev + 1);
    }, 15000); // 15 seconds

    return () => {
      console.log("[picklist-view] Cleaning up polling interval");
      clearInterval(interval);
    };
  }, [currentEvent, id]);

  // Permission checks
  const canView = picklist
    ? canViewPicklist(
        userData.role || "user",
        picklist.type as any,
        picklist.uid,
        userData.uid
      )
    : false;

  const canEdit = picklist
    ? canEditPicklist(
        userData.role || "user",
        picklist.type as any,
        picklist.uid,
        userData.uid
      )
    : false;

  // Debug logging
  console.log("[picklist-view] Permission check:", {
    userRole: userData.role,
    picklistType: picklist?.type,
    picklistUid: picklist?.uid,
    currentUid: userData.uid,
    canView,
    canEdit,
  });

  const isAdmin = userData.role === "admin";

  if (!canView && !initialLoading) {
    navigate({ to: "/home" });
    return null;
  }

  const partitionExcluded = (list: EventPicklistEntry[]) => {
    const included = list.filter((e) => !e.flags?.excluded);
    const excluded = list.filter((e) => e.flags?.excluded);
    return [...included, ...excluded];
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canEdit || !picklist || !currentEvent) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const displayEntries = excludedToBottom
      ? partitionExcluded(entries)
      : entries;
    const oldIndex = displayEntries.findIndex((e) => e.team === active.id);
    const newIndex = displayEntries.findIndex((e) => e.team === over.id);

    let reordered = arrayMove(displayEntries, oldIndex, newIndex).map(
      (e, idx) => ({
        ...e,
        rank: idx + 1,
      })
    );
    if (excludedToBottom) {
      reordered = partitionExcluded(reordered).map((e, idx) => ({
        ...e,
        rank: idx + 1,
      }));
    }

    setEntries(reordered);

    // Save immediately for real-time sync (no toast to avoid spam)
    try {
      const validEntries = reordered.map((e) => ({
        team: e.team,
        rank: e.rank ?? 0,
        flags: e.flags ?? {},
      }));
      await updatePicklist(
        id,
        currentEvent,
        picklist.title || "",
        validEntries,
        picklist.type as any
      );
      console.log("[picklist-view] Saved reorder, will sync to desktop");
    } catch (error) {
      console.error("Failed to update picklist:", error);
      toast.error("Failed to save changes");
      // Revert on error by reloading from database
      loadPicklistData();
    }
  };

  const toggleExclude = async (team: string) => {
    if (!canEdit || !picklist || !currentEvent) return;

    const updated = entries.map((e) =>
      e.team === team
        ? { ...e, flags: { ...e.flags, excluded: !e.flags?.excluded } }
        : e
    );

    setEntries(updated);

    // Save immediately for real-time sync
    try {
      const validEntries = updated.map((e) => ({
        team: e.team,
        rank: e.rank ?? 0,
        flags: e.flags ?? {},
      }));
      await updatePicklist(
        id,
        currentEvent,
        picklist.title || "",
        validEntries,
        picklist.type as any
      );
      console.log("[picklist-view] Saved exclude/include, will sync to desktop");
    } catch (error) {
      console.error("Failed to update picklist:", error);
      toast.error("Failed to save changes");
      // Revert on error by reloading from database
      loadPicklistData();
    }
  };

  const doDelete = async () => {
    if (!isAdmin || !currentEvent) return;
    try {
      await deletePicklist(id, currentEvent);
      toast.success("Picklist deleted");
      navigate({ to: "/home" });
    } catch (error) {
      console.error("Failed to delete picklist:", error);
      toast.error("Failed to delete picklist");
    }
  };

  const handleDelete = () => {
    if (!isAdmin || !currentEvent) return;
    toast.warning("Delete this picklist? This cannot be undone.", {
      action: {
        label: "Delete",
        onClick: () => {
          void doDelete();
        },
      },
      className: "bg-muted text-foreground border border-border",
      actionButtonStyle: {
        backgroundColor: "hsl(var(--destructive))",
        color: "hsl(var(--destructive-foreground))",
      },
      duration: 6000,
    });
  };

  const handleTypeChange = async (
    nextType: "public" | "private" | "default"
  ) => {
    if (!picklist || !currentEvent) return;
    if (picklist.type === nextType) {
      setTypeMenuOpen(false);
      return;
    }
    try {
      await updatePicklist(
        id,
        currentEvent,
        picklist.title || "",
        entries.map((e) => ({
          team: e.team,
          rank: e.rank ?? 0,
          flags: e.flags ?? {},
        })),
        nextType
      );
      setPicklist({ ...picklist, type: nextType });
      toast.success("Picklist type updated");
    } catch (error) {
      console.error("Failed to update picklist type:", error);
      toast.error("Failed to update picklist type");
    } finally {
      setTypeMenuOpen(false);
    }
  };

  const getTeamName = (teamKey: string) => {
    const team = teams.find((t) => t.key === teamKey);
    return team?.name || "";
  };

  const displayEntries = excludedToBottom
    ? partitionExcluded(entries)
    : entries;

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!picklist) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-background">
        <div className="text-muted-foreground mb-4">Picklist not found</div>
        <Button onClick={() => navigate({ to: "/home" })}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background p-1">
      {/* Header */}
      <header className="shrink-0 px-7 py-6">
        <div className="grid grid-cols-3 items-center">
          <div className="flex items-center">
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-4"
              onClick={() => navigate({ to: "/home" })}
            >
              Close
            </Button>
          </div>
          <div className="flex justify-center">
            <p className="text-primary text-xl font-medium truncate">
              {picklist.title}
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            {isAdmin && (
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                Delete
              </Button>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted px-5 py-2.5 text-sm text-primary"
              onClick={() => setTypeMenuOpen((v) => !v)}
            >
              {picklist.type || "default"}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M6 9L12 15L18 9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {typeMenuOpen && (
              <div className="absolute left-0 mt-2 w-44 rounded-xl border border-border bg-background p-2 shadow-lg z-20">
                {(["public", "private", "default"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent ${
                      picklist.type === type
                        ? "text-primary"
                        : "text-foreground"
                    }`}
                    onClick={() => handleTypeChange(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 rounded-xl border-2 border-border bg-muted px-5 py-2.5">
            <Switch
              checked={excludedToBottom}
              onCheckedChange={setExcludedToBottom}
              className={`ring-2 ring-offset-2 ring-offset-background ${
                excludedToBottom
                  ? "ring-primary/50"
                  : "ring-muted-foreground/50"
              }`}
            />
            <span className="text-sm text-muted-foreground">
              Excluded to bottom
            </span>
          </div>
        </div>
      </header>

      <div className="px-5">
        <div className="h-px w-full bg-border" />
      </div>

      {/* Team List */}
      <main className="flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {displayEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No teams in this picklist
          </div>
        ) : canEdit ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={displayEntries.map((e) => e.team)}
              strategy={verticalListSortingStrategy}
            >
              {displayEntries.map((entry) => (
                <SortableTeamRow
                  key={entry.team}
                  entry={entry}
                  teamName={getTeamName(entry.team)}
                  teamRank={teams.find((t: any) => t.key === entry.team)?.rank}
                  onToggleExclude={toggleExclude}
                  canEdit={canEdit}
                  onNavigateToTeam={(team) =>
                    navigate({ to: "/team-info", search: { teamKey: team } })
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          displayEntries.map((entry) => (
            <TeamRow
              key={entry.team}
              entry={entry}
              teamName={getTeamName(entry.team)}
              teamRank={teams.find((t: any) => t.key === entry.team)?.rank}
              onNavigateToTeam={(team) =>
                navigate({ to: "/team-info", search: { teamKey: team } })
              }
            />
          ))
        )}
      </main>
    </div>
  );
}

// Sortable team row (for editable picklists)
function SortableTeamRow({
  entry,
  teamName,
  teamRank,
  onToggleExclude,
  canEdit,
  onNavigateToTeam,
}: {
  entry: EventPicklistEntry;
  teamName: string;
  teamRank?: number;
  onToggleExclude: (team: string) => void;
  canEdit: boolean;
  onNavigateToTeam: (team: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.team });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const isExcluded = !!entry.flags?.excluded;
  const teamNumber = entry.team.replace("frc", "");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-2xl bg-muted px-5 py-6 mb-3 last:mb-0 min-h-[80px] ${
        isDragging ? "ring-2 ring-primary" : ""
      }`}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div
          className={`flex items-center gap-2 min-w-0 ${
            isExcluded ? "opacity-60" : ""
          }`}
        >
          <div className="text-xs font-semibold text-primary w-4 text-center">
            {entry.rank}
          </div>
          {canEdit && (
            <div
              {...attributes}
              {...listeners}
              className="cursor-grab text-foreground rounded-xl bg-background/60 p-3"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
                <circle cx="9" cy="5" r="1" />
                <circle cx="9" cy="12" r="1" />
                <circle cx="9" cy="19" r="1" />
                <circle cx="15" cy="5" r="1" />
                <circle cx="15" cy="12" r="1" />
                <circle cx="15" cy="19" r="1" />
              </svg>
            </div>
          )}

          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => onNavigateToTeam(entry.team)}
          >
            <p className="text-base truncate">
              <span className="font-bold text-primary">{teamNumber}</span>
              <span className="text-foreground"> | </span>
              <span className="text-foreground">{teamName || entry.team}</span>
            </p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-border">
                Rank{" "}
                <span className="text-primary font-semibold">
                  #{teamRank ?? "—"}
                </span>
              </p>
              {isExcluded && <Badge variant="destructive">Excluded</Badge>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              type="button"
              className="p-1"
              onClick={() => onToggleExclude(entry.team)}
              aria-label={isExcluded ? "Include team" : "Exclude team"}
            >
              <svg
                viewBox="0 0 24 24"
                className={
                  isExcluded ? "text-destructive" : "text-muted-foreground"
                }
                style={{ width: 22, height: 22 }}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="8.5"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M8 8L16 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="p-1 text-primary"
            onClick={() => onNavigateToTeam(entry.team)}
          >
            <svg
              viewBox="0 0 24 24"
              style={{ width: 20, height: 20 }}
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M9 18L15 12L9 6"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// Read-only team row
function TeamRow({
  entry,
  teamName,
  teamRank,
  onNavigateToTeam,
}: {
  entry: EventPicklistEntry;
  teamName: string;
  teamRank?: number;
  onNavigateToTeam: (team: string) => void;
}) {
  const isExcluded = !!entry.flags?.excluded;
  const teamNumber = entry.team.replace("frc", "");

  return (
    <div className="rounded-2xl bg-muted px-5 py-6 mb-3 last:mb-0 min-h-[80px]">
      <div className="flex w-full items-center justify-between gap-3">
        <div className="text-xs font-semibold text-primary w-4 text-center">
          {entry.rank}
        </div>
        <div
          className={`flex-1 min-w-0 cursor-pointer ${
            isExcluded ? "opacity-60" : ""
          }`}
          onClick={() => onNavigateToTeam(entry.team)}
        >
          <p className="text-base truncate">
            <span className="font-bold text-primary">{teamNumber}</span>
            <span className="text-foreground"> | </span>
            <span className="text-foreground">{teamName || entry.team}</span>
          </p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-border">
              Rank{" "}
              <span className="text-primary font-semibold">
                #{teamRank ?? "—"}
              </span>
            </p>
            {isExcluded && <Badge variant="destructive">Excluded</Badge>}
          </div>
        </div>
        <button
          type="button"
          className="p-1 text-primary"
          onClick={() => onNavigateToTeam(entry.team)}
        >
          <svg
            viewBox="0 0 24 24"
            style={{ width: 20, height: 20 }}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M9 18L15 12L9 6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
