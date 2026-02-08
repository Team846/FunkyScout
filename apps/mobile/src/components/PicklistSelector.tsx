import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
import { useEvent } from "@lib/context/EventContext";
import { getEventPicklists } from "@lib/db";
import { canViewPicklist } from "@lib/utils/permissions";
import { getLocalUserData } from "@lib/supabase/user";
import type { EventPicklist } from "@lib/db";

export function PicklistSelector({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const { currentEvent } = useEvent();
  const userData = getLocalUserData();
  const [picklists, setPicklists] = useState<EventPicklist[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !currentEvent) return;

    setLoading(true);
    getEventPicklists(currentEvent)
      .then((lists) => {
        // Filter by permissions
        const visiblePicklists = lists.filter((p) =>
          canViewPicklist(
            userData.role || "user",
            p.type as any,
            p.uid,
            userData.uid
          )
        );
        setPicklists(visiblePicklists);
      })
      .catch((error) => {
        console.error("Failed to load picklists:", error);
        setPicklists([]);
      })
      .finally(() => setLoading(false));
  }, [open, currentEvent, userData.role, userData.uid]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select Picklist</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading...
          </div>
        ) : picklists.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No picklists available
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {picklists.map((p) => (
              <div
                key={p.id}
                onClick={() => {
                  onSelect(p.id!);
                  onClose();
                }}
                className="cursor-pointer border rounded-lg p-3 hover:bg-accent transition-colors"
              >
                <div className="font-semibold">{p.title}</div>
                <div className="text-sm text-muted-foreground">
                  {[p.type, p.uname].filter(Boolean).join(" • ") || "No info"}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
