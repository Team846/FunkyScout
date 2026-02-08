import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
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
    <Dialog
      open
      onOpenChange={() => {
        navigate({ to: "/home" });
      }}
    >
      <DialogContent className="w-[80vw] max-w-[22rem] p-0">
        <div className="w-full px-5 py-8 flex flex-col gap-5 mx-auto">
          <DialogHeader>
            <DialogTitle className="text-primary text-lg">
              New Picklist
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Input
              id="title"
              placeholder="Enter picklist title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-12 w-full rounded-2xl border-border bg-muted px-4 text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary"
            />

            <div className="flex items-center gap-2">
              {(["public", "default", "private"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`flex-1 rounded-xl border px-3 py-2 text-xs capitalize transition-colors ${
                    type === opt
                      ? "border-primary text-primary bg-background/40"
                      : "border-border text-muted-foreground bg-muted"
                  }`}
                  onClick={() => setType(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => navigate({ to: "/home" })}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleCreate}
              disabled={creating || !title.trim() || teams.length === 0}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
