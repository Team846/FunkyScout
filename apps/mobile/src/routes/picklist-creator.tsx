import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shadcn/ui/components/select.tsx";
import { useEvent } from "@lib/context/EventContext";
import { useTeamData } from "@lib/context/TeamDataContext";
import { createPicklist } from "@lib/data/writes";
import { canCreatePicklist } from "@lib/utils/permissions";
import { getLocalUserData } from "@lib/supabase/user";
import { toast } from "sonner";

export const Route = createFileRoute("/picklist-creator")({
  component: PicklistCreatorPage,
});

function PicklistCreatorPage() {
  const navigate = useNavigate();
  const { currentEvent } = useEvent();
  const userData = getLocalUserData();
  const { teams } = useTeamData();

  const [title, setTitle] = useState("");
  const [type, setType] = useState<"public" | "private" | "default">("public");
  const [creating, setCreating] = useState(false);

  // Permission check - redirect if not admin
  if (!canCreatePicklist(userData.role || "user")) {
    navigate({ to: "/home" });
    return null;
  }

  const handleCreate = async () => {
    if (!currentEvent) {
      toast.error("No event selected");
      return;
    }

    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    if (teams.length === 0) {
      toast.error("No teams available for this event");
      return;
    }

    setCreating(true);
    try {
      // Automatically include all teams, sorted by rank
      const sortedTeams = [...teams].sort((a, b) => a.rank - b.rank);
      const entries = sortedTeams.map((team, idx) => ({
        team: team.key,
        rank: idx + 1,
        flags: {},
      }));

      const id = await createPicklist(
        currentEvent,
        title,
        entries,
        userData.uid,
        userData.name || "Unknown",
        type,
      );

      toast.success("Picklist created");
      navigate({ to: "/picklist-view", search: { id } });
    } catch (error) {
      console.error("Failed to create picklist:", error);
      toast.error("Failed to create picklist");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="flex items-center justify-between p-4 border-b">
        <h1 className="text-xl font-semibold">New Picklist</h1>
        <Button
          variant="ghost"
          onClick={() => navigate({ to: "/home" })}
        >
          Cancel
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Title Input */}
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            placeholder="Enter picklist title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Type Selector */}
        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as any)}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">
                <div>
                  <div className="font-medium">Public</div>
                  <div className="text-xs text-muted-foreground">
                    Scouters and admins can view and edit
                  </div>
                </div>
              </SelectItem>
              <SelectItem value="default">
                <div>
                  <div className="font-medium">Default</div>
                  <div className="text-xs text-muted-foreground">
                    Scouters can view; admins can edit
                  </div>
                </div>
              </SelectItem>
              <SelectItem value="private">
                <div>
                  <div className="font-medium">Private</div>
                  <div className="text-xs text-muted-foreground">
                    Only you can view and edit
                  </div>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Team Info */}
        <div className="space-y-2">
          <Label>Teams</Label>
          <div className="border rounded-lg p-4">
            <div className="text-sm text-muted-foreground">
              {teams.length > 0 ? (
                <>
                  All {teams.length} teams will be automatically included in
                  this picklist, sorted by their current rank. You can reorder
                  them after creation.
                </>
              ) : (
                "No teams available for this event"
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create Button */}
      <div className="p-4 border-t">
        <Button
          className="w-full"
          onClick={handleCreate}
          disabled={creating || !title.trim() || teams.length === 0}
        >
          {creating ? "Creating..." : "Create Picklist"}
        </Button>
      </div>
    </div>
  );
}
