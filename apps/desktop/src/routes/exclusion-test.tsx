import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shadcn/ui/components/card.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shadcn/ui/components/select.tsx";
import { GripVertical, X, Check, Loader2, Save } from "lucide-react";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { usePicklistEditor } from "@lib/hooks/usePicklistEditor";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";

export const Route = createFileRoute("/exclusion-test")({
  component: PicklistEditorPage,
});

interface SortableItemProps {
  team: string;
  rank: number;
  excluded: boolean;
  onToggleExclude: () => void;
}

function SortableItem({ team, rank, excluded, onToggleExclude }: SortableItemProps) {
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
      className={`flex items-center gap-3 p-3 border rounded-lg bg-card ${
        excluded ? "opacity-50 bg-muted" : ""
      }`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1">
        <div className="font-medium">{team}</div>
        <div className="text-xs text-muted-foreground">Rank {rank}</div>
      </div>
      <Button
        size="sm"
        variant={excluded ? "default" : "outline"}
        onClick={onToggleExclude}
      >
        {excluded ? (
          <>
            <Check className="h-4 w-4 mr-1" />
            Include
          </>
        ) : (
          <>
            <X className="h-4 w-4 mr-1" />
            Exclude
          </>
        )}
      </Button>
    </div>
  );
}

function PicklistEditorPage() {
  const { currentEvent } = useDesktopEvent();
  const { picklists, picklistEntries, refreshFromCache } = useDesktopCompetitionData();
  const [selectedPicklistId, setSelectedPicklistId] = useState<string | null>(null);

  // Find selected picklist and its entries
  const selectedPicklist = picklists.find((p) => p.id === selectedPicklistId);
  const selectedEntries = selectedPicklistId
    ? picklistEntries.filter((e) => e.id === selectedPicklistId)
    : [];

  // Use the picklist editor hook
  const {
    entries,
    hasChanges,
    isSaving,
    handleDragEnd: hookHandleDragEnd,
    toggleExclude,
    saveChanges,
    resetChanges,
  } = usePicklistEditor({
    initialEntries: selectedEntries,
    picklistId: selectedPicklistId || "",
    eventKey: currentEvent || "",
    title: selectedPicklist?.title || "",
    type: selectedPicklist?.type as "public" | "private" | "default" | undefined,
    excludedToBottom: true,
    onSaveSuccess: async () => {
      toast.success("Picklist saved successfully");
      // Refresh from cache to immediately show the change in UI
      // (updatePicklist already cached the data, we just need to update React state)
      await refreshFromCache();
    },
    onSaveError: (error) => {
      toast.error(`Failed to save picklist: ${error.message}`);
    },
  });

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    hookHandleDragEnd(event);
  };

  if (!currentEvent) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Picklist Editor</CardTitle>
            <CardDescription>Please select an event to edit picklists</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Picklist Editor - {currentEvent}</CardTitle>
          <CardDescription>
            Select a picklist, drag to reorder, and exclude/include teams
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Picklist Selector */}
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Select Picklist:</label>
            <Select
              value={selectedPicklistId || "none"}
              onValueChange={(value) => setSelectedPicklistId(value === "none" ? null : value)}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Choose a picklist..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a picklist...</SelectItem>
                {picklists.map((picklist) => (
                  <SelectItem key={picklist.id} value={picklist.id}>
                    {picklist.title} ({picklist.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Editor */}
          {selectedPicklistId && entries.length > 0 ? (
            <>
              {/* Save Controls */}
              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                <div className="text-sm">
                  {hasChanges ? (
                    <span className="text-orange-600 font-medium">Unsaved changes</span>
                  ) : (
                    <span className="text-muted-foreground">All changes saved</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={resetChanges}
                    disabled={!hasChanges || isSaving}
                  >
                    Reset
                  </Button>
                  <Button
                    onClick={saveChanges}
                    disabled={!hasChanges || isSaving}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Drag-and-Drop List */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={entries.map((e) => e.team)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {entries.map((entry) => (
                      <SortableItem
                        key={entry.team}
                        team={entry.team}
                        rank={entry.rank || 0}
                        excluded={!!entry.flags?.excluded}
                        onToggleExclude={() => toggleExclude(entry.team)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <div className="text-xs text-muted-foreground text-center pt-4">
                {entries.filter((e) => !e.flags?.excluded).length} included,{" "}
                {entries.filter((e) => e.flags?.excluded).length} excluded
              </div>
            </>
          ) : selectedPicklistId ? (
            <div className="text-center py-12 text-muted-foreground">
              This picklist is empty
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              Select a picklist to start editing
            </div>
          )}

          {picklists.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No picklists found for this event
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
