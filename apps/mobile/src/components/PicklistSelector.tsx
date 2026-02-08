import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
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
  const [search, setSearch] = useState("");

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

  const filteredPicklists = picklists.filter((p) => {
    const query = search.toLowerCase();
    return (
      (p.title || "").toLowerCase().includes(query) ||
      (p.type || "").toLowerCase().includes(query) ||
      (p.uname || "").toLowerCase().includes(query)
    );
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-[80vw] max-w-[22rem] p-0">
        <div className="w-full px-5 py-8 flex flex-col gap-4 mx-auto">
          <DialogHeader>
            <DialogTitle className="text-primary">Select Picklist</DialogTitle>
          </DialogHeader>

          {/* Search Bar */}
          <div className="relative">
            <Input
              placeholder="Search picklists..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-12 w-full rounded-2xl border-border bg-muted pl-4 pr-10 text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-primary">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M21 21L15.0001 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>

          {loading ? (
            <p className="text-center text-muted-foreground">Loading...</p>
          ) : picklists.length === 0 ? (
            <p className="text-center text-muted-foreground">
              No picklists available
            </p>
          ) : filteredPicklists.length === 0 ? (
            <p className="text-center text-muted-foreground">
              No picklists found
            </p>
          ) : (
            <div className="flex max-h-80 overflow-y-auto flex-col gap-3">
              {filteredPicklists.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    onSelect(p.id!);
                    onClose();
                  }}
                  className="group relative flex w-full cursor-pointer items-center justify-between rounded-xl border border-border bg-muted px-5 py-4 transition-colors hover:bg-accent/50"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-md font-medium text-primary truncate">
                      {p.title}
                    </span>
                    <span className="text-sm text-muted-foreground truncate">
                      {[p.type, p.uname].filter(Boolean).join(" • ") || "No info"}
                    </span>
                  </div>

                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    xmlns="http://www.w3.org/2000/svg"
                    className="text-primary"
                  >
                    <path
                      d="M8 4L16 12L8 20"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
