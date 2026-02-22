import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shadcn/ui/components/card.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shadcn/ui/components/select.tsx";
import { ArrowLeft, Plus, Trash2, GripVertical } from "lucide-react";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopTeamData } from "../contexts/DesktopTeamDataContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { createPicklist, deletePicklist } from "@lib/data/writes";
import { getLocalUserData } from "@lib/supabase/user";
import { usePicklistEditor } from "@lib/hooks/usePicklistEditor";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const Route = createFileRoute("/test-picklists")({
  component: TestPicklistsPage,
});

interface SortableTeamItemProps {
  team: string;
  rank: number;
  excluded: boolean;
  onToggleExclude: (team: string) => void;
}

function SortableTeamItem({ team, rank, excluded, onToggleExclude }: SortableTeamItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: team });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 border rounded-lg bg-background ${
        excluded ? "opacity-50 bg-muted" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing hover:bg-muted p-1 rounded"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      <span className="font-mono text-sm text-muted-foreground w-8">
        {rank}.
      </span>
      <span className="font-medium flex-1">{team.replace("frc", "")}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onToggleExclude(team)}
        className={excluded ? "border-green-600 text-green-600" : "border-red-600 text-red-600"}
      >
        {excluded ? "Include" : "Exclude"}
      </Button>
    </div>
  );
}

function TestPicklistsPage() {
  const navigate = useNavigate();
  const { currentEvent } = useDesktopEvent();
  const { teams } = useDesktopTeamData();
  const { picklists, refresh } = useDesktopCompetitionData();

  const [selectedPicklistId, setSelectedPicklistId] = useState<string | null>(null);
  const [picklistTitle, setPicklistTitle] = useState("");
  const [picklistType, setPicklistType] = useState<"public" | "private" | "default">("public");
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // 15-second polling for conflict detection (realtime subscriptions are disabled)
  // Calls refresh() which checks Supabase for updates
  useEffect(() => {
    if (!currentEvent || !selectedPicklistId) return;

    console.log("[test-picklists] Starting 15s polling for conflict detection");
    const interval = setInterval(() => {
      console.log("[test-picklists] 15s poll - checking for updates");
      refresh();
    }, 15000); // Check every 15 seconds

    return () => clearInterval(interval);
  }, [currentEvent, selectedPicklistId, refresh]);

  // Memoize picklist and entries to prevent flash during refresh
  const selectedPicklist = useMemo(
    () => picklists.find((p) => p.id === selectedPicklistId),
    [picklists, selectedPicklistId]
  );

  // Get embedded entries from the selected picklist
  const selectedEntries = useMemo(
    () => selectedPicklist?.picklist ?? [],
    [selectedPicklist]
  );

  console.log(`[test-picklists] Selected picklist ${selectedPicklistId}: ${selectedEntries.length} entries`, selectedEntries.slice(0, 3));

  // Initialize picklist editor hook for the selected picklist
  // Only initialize if we have a valid selected picklist for the current event
  const isValidSelection = selectedPicklistId && selectedPicklist && selectedPicklist.event === currentEvent;

  const {
    entries,
    hasChanges,
    isSaving,
    handleDragEnd: editorHandleDragEnd,
    toggleExclude,
    saveChanges,
  } = usePicklistEditor({
    initialEntries: isValidSelection ? selectedEntries : [],
    picklistId: selectedPicklistId || "",
    eventKey: currentEvent || "",
    title: selectedPicklist?.title || "",
    type: (selectedPicklist?.type as "public" | "private" | "default") || "public",
    onRemoteChangesDetected: (hasUnsavedChanges, acceptChanges, rejectChanges) => {
      const message = hasUnsavedChanges
        ? "Someone else updated this picklist. You have unsaved changes."
        : "Someone else updated this picklist.";

      const accept = window.confirm(
        `${message}\n\nClick OK to accept their changes, or Cancel to keep your version.`
      );

      if (accept) {
        acceptChanges();
        alert("Loaded remote changes");
      } else {
        rejectChanges();
        alert("Keeping your version - save to sync with Supabase");
      }
    },
  });

  // Update title and type when switching to a different picklist (not on refresh)
  useEffect(() => {
    if (selectedPicklist && selectedPicklist.id === selectedPicklistId) {
      setPicklistTitle(selectedPicklist.title);
      setPicklistType((selectedPicklist.type as "public" | "private" | "default") || "public");
    }
  }, [selectedPicklistId]); // Only update when picklistId changes, not on every data refresh

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleCreatePicklist = async () => {
    if (!currentEvent) {
      alert("Please select an event first");
      return;
    }

    if (!picklistTitle.trim()) {
      alert("Please enter a picklist title");
      return;
    }

    setIsCreating(true);
    try {
      const userData = getLocalUserData();

      // Create picklist with all teams sorted by rank
      const sortedTeams = [...teams].sort((a, b) => {
        const rankA = a.rank ?? 999;
        const rankB = b.rank ?? 999;
        return rankA - rankB;
      });

      const newEntries = sortedTeams.map((team, idx) => ({
        team: team.key,
        rank: idx + 1,
        flags: {},
      }));

      await createPicklist(
        currentEvent,
        picklistTitle,
        newEntries,
        userData.uid,
        userData.name || "Unknown",
        picklistType
      );

      alert(`✅ Picklist "${picklistTitle}" created!`);

      // Refresh data to immediately show the new picklist
      await refresh();
    } catch (error) {
      console.error("Failed to create picklist:", error);
      alert(`❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeletePicklist = () => {
    if (!selectedPicklistId || !currentEvent) {
      alert("Cannot delete: missing picklist ID or event");
      return;
    }
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!selectedPicklistId || !currentEvent) return;

    setShowDeleteConfirm(false);
    setIsDeleting(true);
    try {
      await deletePicklist(selectedPicklistId, currentEvent);
      setSelectedPicklistId(null);
      await refresh();
      alert("✅ Picklist deleted!");
    } catch (error) {
      console.error("[test-picklists] Delete failed:", error);
      alert(`❌ Failed to delete: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const displayEntries = entries.filter((e) => !e.flags?.excluded);
  const excludedEntries = entries.filter((e) => e.flags?.excluded);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b flex-shrink-0">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate({ to: "/dashboard" })}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Picklist Testing</h1>
              <p className="text-sm text-muted-foreground">
                Test create, edit, reorder, exclude, and delete
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column: Create & Select */}
            <div className="space-y-6">
              {/* Create New Picklist */}
              <Card>
                <CardHeader>
                  <CardTitle>Create New Picklist</CardTitle>
                  <CardDescription>
                    Creates a picklist with {teams.length} teams sorted by rank
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      placeholder="Enter picklist title"
                      value={picklistTitle}
                      onChange={(e) => setPicklistTitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <div className="flex gap-2">
                      {(["public", "default", "private"] as const).map((type) => (
                        <Button
                          key={type}
                          type="button"
                          variant={picklistType === type ? "default" : "outline"}
                          className="flex-1 capitalize"
                          onClick={() => setPicklistType(type)}
                        >
                          {type}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button
                    onClick={handleCreatePicklist}
                    disabled={isCreating || !picklistTitle.trim() || !currentEvent}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {isCreating ? "Creating..." : "Create Picklist"}
                  </Button>
                </CardContent>
              </Card>

              {/* Select Existing Picklist */}
              <Card>
                <CardHeader>
                  <CardTitle>Select Picklist to Edit</CardTitle>
                  <CardDescription>
                    {picklists.length} picklist(s) available
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Select
                    value={selectedPicklistId ?? ""}
                    onValueChange={(value) => setSelectedPicklistId(value || null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a picklist" />
                    </SelectTrigger>
                    <SelectContent>
                      {picklists.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title} ({p.type}) - {p.uname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedPicklist && (
                    <div className="pt-4 border-t space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {displayEntries.length} teams (
                          {excludedEntries.length} excluded)
                          {hasChanges && <span className="text-yellow-600"> (unsaved)</span>}
                        </span>
                        <div className="flex gap-2">
                          {hasChanges && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => saveChanges()}
                              disabled={isSaving}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              {isSaving ? "Saving..." : "Save"}
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleDeletePicklist}
                            disabled={isDeleting}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {isDeleting ? "Deleting..." : "Delete"}
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        💡 {hasChanges ? "Click Save to sync with Supabase" : "Changes are synced with Supabase"}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column: Edit Picklist */}
            <div>
              {selectedPicklist ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Edit: {selectedPicklist.title}</CardTitle>
                    <CardDescription>
                      Drag to reorder • Click to exclude/include teams
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {/* Active Teams */}
                      <div>
                        <h3 className="text-sm font-medium mb-3">
                          Active Teams ({displayEntries.length})
                        </h3>
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={editorHandleDragEnd}
                        >
                          <SortableContext
                            items={displayEntries.map((e) => e.team)}
                            strategy={verticalListSortingStrategy}
                          >
                            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                              {displayEntries.map((entry) => (
                                <SortableTeamItem
                                  key={entry.team}
                                  team={entry.team}
                                  rank={entry.rank ?? 0}
                                  excluded={false}
                                  onToggleExclude={toggleExclude}
                                />
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      </div>

                      {/* Excluded Teams */}
                      {excludedEntries.length > 0 && (
                        <div>
                          <h3 className="text-sm font-medium mb-3 text-muted-foreground">
                            Excluded Teams ({excludedEntries.length})
                          </h3>
                          <div className="space-y-2">
                            {excludedEntries.map((entry) => (
                              <div
                                key={entry.team}
                                className="flex items-center gap-3 p-3 border rounded-lg bg-muted"
                              >
                                <span className="font-medium flex-1">
                                  {entry.team.replace("frc", "")}
                                </span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => toggleExclude(entry.team)}
                                  className="border-green-600 text-green-600"
                                >
                                  Include
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    <p>Select a picklist to edit</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Delete Picklist</CardTitle>
              <CardDescription>
                Are you sure you want to delete "{selectedPicklist?.title}"? This action cannot be undone.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
