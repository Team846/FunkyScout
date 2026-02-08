import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Badge } from "@shadcn/ui/components/badge.tsx";
import { useEvent } from "@lib/context/EventContext";
import { useTeamData } from "@lib/context/TeamDataContext";
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
  const [picklist, setPicklist] = useState<EventPicklist | null>(null);
  const [entries, setEntries] = useState<EventPicklistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!currentEvent || !id) return;

    setLoading(true);
    getPicklistById(currentEvent, id)
      .then(({ picklist, entries }) => {
        console.log("[picklist-view] Loaded picklist:", picklist);
        console.log(
          "[picklist-view] Type:",
          picklist?.type,
          "Uname:",
          picklist?.uname
        );
        setPicklist(picklist);
        setEntries(entries);
      })
      .catch((error) => {
        console.error("Failed to load picklist:", error);
        toast.error("Failed to load picklist");
      })
      .finally(() => setLoading(false));
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

  const isAdmin = userData.role === "admin";

  if (!canView && !loading) {
    navigate({ to: "/home" });
    return null;
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canEdit || !picklist || !currentEvent) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = entries.findIndex((e) => e.team === active.id);
    const newIndex = entries.findIndex((e) => e.team === over.id);

    const reordered = arrayMove(entries, oldIndex, newIndex).map((e, idx) => ({
      ...e,
      rank: idx + 1,
    }));

    setEntries(reordered);

    try {
      // Ensure all entries have required fields
      const validEntries = reordered.map((e) => ({
        team: e.team,
        rank: e.rank ?? 0,
        flags: e.flags ?? {},
      }));
      await updatePicklist(
        id,
        currentEvent,
        picklist.title || "",
        validEntries
      );
    } catch (error) {
      console.error("Failed to update picklist:", error);
      toast.error("Failed to save changes");
      // Revert on error
      setEntries(entries);
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

    try {
      // Ensure all entries have rank defined
      const validEntries = updated.map((e) => ({
        team: e.team,
        rank: e.rank ?? 0,
        flags: e.flags ?? {},
      }));
      await updatePicklist(
        id,
        currentEvent,
        picklist.title || "",
        validEntries
      );
      toast.success("Team exclusion updated");
    } catch (error) {
      console.error("Failed to update picklist:", error);
      toast.error("Failed to save changes");
      // Revert on error
      setEntries(entries);
    }
  };

  const handleDelete = async () => {
    if (!isAdmin || !currentEvent) return;

    if (!confirm("Delete this picklist? This cannot be undone.")) return;

    try {
      await deletePicklist(id, currentEvent);
      toast.success("Picklist deleted");
      navigate({ to: "/home" });
    } catch (error) {
      console.error("Failed to delete picklist:", error);
      toast.error("Failed to delete picklist");
    }
  };

  const getTeamName = (teamKey: string) => {
    const team = teams.find((t) => t.key === teamKey);
    return team?.name || "";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!picklist) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background">
        <div className="text-muted-foreground mb-4">Picklist not found</div>
        <Button onClick={() => navigate({ to: "/home" })}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="p-4 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{picklist.title}</h1>
          <Button variant="ghost" onClick={() => navigate({ to: "/home" })}>
            Close
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {picklist.type && <Badge variant="outline">{picklist.type}</Badge>}
          {picklist.uname && (
            <span className="text-sm text-muted-foreground">
              by {picklist.uname}
            </span>
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Delete Picklist
            </Button>
          </div>
        )}
      </div>

      {/* Team List */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
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
              items={entries.map((e) => e.team)}
              strategy={verticalListSortingStrategy}
            >
              {entries.map((entry) => (
                <SortableTeamRow
                  key={entry.team}
                  entry={entry}
                  teamName={getTeamName(entry.team)}
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
          // Read-only view
          <div className="divide-y">
            {entries.map((entry) => (
              <TeamRow
                key={entry.team}
                entry={entry}
                teamName={getTeamName(entry.team)}
                onNavigateToTeam={(team) =>
                  navigate({ to: "/team-info", search: { teamKey: team } })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Sortable team row (for editable picklists)
function SortableTeamRow({
  entry,
  teamName,
  onToggleExclude,
  canEdit,
  onNavigateToTeam,
}: {
  entry: EventPicklistEntry;
  teamName: string;
  onToggleExclude: (team: string) => void;
  canEdit: boolean;
  onNavigateToTeam: (team: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: entry.team });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-4 border-b bg-background"
    >
      {canEdit && (
        <div {...attributes} {...listeners} className="cursor-grab">
          <svg
            viewBox="0 0 24 24"
            className="size-5 text-muted-foreground"
            fill="currentColor"
          >
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="19" r="1" />
          </svg>
        </div>
      )}

      <div className="w-8 text-sm font-medium text-muted-foreground">
        {entry.rank}
      </div>

      <div
        className="flex-1 cursor-pointer"
        onClick={() => onNavigateToTeam(entry.team)}
      >
        <div className="font-medium">{entry.team}</div>
        {teamName && (
          <div className="text-sm text-muted-foreground">{teamName}</div>
        )}
      </div>

      {entry.flags?.excluded && <Badge variant="secondary">Excluded</Badge>}

      {canEdit && (
        <Button
          variant={entry.flags?.excluded ? "default" : "outline"}
          size="sm"
          onClick={() => onToggleExclude(entry.team)}
        >
          {entry.flags?.excluded ? "Include" : "Exclude"}
        </Button>
      )}
    </div>
  );
}

// Read-only team row
function TeamRow({
  entry,
  teamName,
  onNavigateToTeam,
}: {
  entry: EventPicklistEntry;
  teamName: string;
  onNavigateToTeam: (team: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 p-4 border-b bg-background">
      <div className="w-8 text-sm font-medium text-muted-foreground">
        {entry.rank}
      </div>

      <div
        className="flex-1 cursor-pointer"
        onClick={() => onNavigateToTeam(entry.team)}
      >
        <div className="font-medium">{entry.team}</div>
        {teamName && (
          <div className="text-sm text-muted-foreground">{teamName}</div>
        )}
      </div>

      {entry.flags?.excluded && <Badge variant="secondary">Excluded</Badge>}
    </div>
  );
}
