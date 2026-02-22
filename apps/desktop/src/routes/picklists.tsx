import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Search, Settings, PlusCircle, Lock, Globe, AlignJustify } from "lucide-react";
import { useTabContext } from "../contexts/TabContext";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
import { Label } from "@shadcn/ui/components/label.tsx";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { getLocalUserData } from "@lib/supabase/user";
import { createPicklist } from "@lib/data/writes";
import { toast } from "sonner";

export const Route = createFileRoute("/picklists")({
  component: PicklistsPage,
});

type PicklistType = "public" | "private" | "default";
type SortBy = "date" | "alphabetical";

const TYPE_LABELS: Record<PicklistType, string> = {
  private: "Private",
  public: "Public",
  default: "Default",
};
const TYPE_CYCLE: PicklistType[] = ["private", "public", "default"];

function formatTimestamp(ts: string | number | null | undefined): string {
  if (!ts) return "00/00 @ 00:00";
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} @ ${hh}:${min}`;
}

function PicklistsPage() {
  const navigate = useNavigate();
  const { addTab } = useTabContext();
  const { currentEvent } = useDesktopEvent();
  const { picklists, refresh } = useDesktopCompetitionData();
  const userData = getLocalUserData();

  // Settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [defaultVisibility, setDefaultVisibility] = useState<PicklistType>("private");
  const [sortBy, setSortBy] = useState<SortBy>("date");

  // UI
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<PicklistType>(defaultVisibility);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    let list = picklists.filter((p) => !(p as unknown as { deleted_at?: unknown }).deleted_at);
    if (showOnlyMine) list = list.filter((p) => p.uid === userData.uid);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.title?.toLowerCase().includes(q));
    }
    if (sortBy === "alphabetical") {
      list = [...list].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    } else {
      list = [...list].sort((a, b) => {
        const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return bTime - aTime;
      });
    }
    return list;
  }, [picklists, showOnlyMine, search, sortBy, userData.uid]);

  const handleSelect = (picklist: (typeof picklists)[number]) => {
    setSelectedId(picklist.id);
    addTab("/exclusion-test", picklist.title || "Untitled", { id: picklist.id }, `picklist-${picklist.id}`);
    navigate({ to: "/exclusion-test", search: { id: picklist.id } });
  };

  const openCreateDialog = () => {
    setNewTitle("");
    setNewType(defaultVisibility);
    setCreateDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!newTitle.trim() || !currentEvent || creating) return;
    setCreating(true);
    try {
      const id = await createPicklist(
        currentEvent,
        newTitle.trim(),
        [],
        userData.uid || "",
        userData.name || "",
        newType
      );
      await refresh();
      toast.success("Picklist created");
      setCreateDialogOpen(false);
      addTab("/exclusion-test", newTitle.trim(), { id }, `picklist-${id}`);
      navigate({ to: "/exclusion-test", search: { id } });
    } catch {
      toast.error("Failed to create picklist");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left Sidebar ── */}
      <div className="w-[280px] flex-shrink-0 flex flex-col h-full border-r border-border bg-card">

        {/* Header — dashed border box */}
        <div className="px-3 pt-3 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 border border-dashed border-primary/40 rounded-lg">
            <AlignJustify className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground">Picklist Menu</span>
            <div className="flex-1 border-t border-dashed border-primary/40 mx-1" />
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className={[
                "p-1.5 rounded-md border transition-colors flex-shrink-0",
                settingsOpen
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40",
              ].join(" ")}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Settings dropdown */}
        {settingsOpen && (
          <div className="px-4 py-3 space-y-2.5 bg-card">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Show only user picklists</span>
              <button
                onClick={() => setShowOnlyMine((v) => !v)}
                className={[
                  "text-xs px-3 py-1 rounded-md font-medium transition-colors",
                  showOnlyMine
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-secondary",
                ].join(" ")}
              >
                {showOnlyMine ? "Disable" : "Enable"}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Default visibility</span>
              <button
                onClick={() =>
                  setDefaultVisibility(
                    (v) => TYPE_CYCLE[(TYPE_CYCLE.indexOf(v) + 1) % TYPE_CYCLE.length]
                  )
                }
                className="text-xs px-3 py-1 rounded-md bg-muted text-muted-foreground hover:bg-secondary font-medium transition-colors"
              >
                {TYPE_LABELS[defaultVisibility]}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Sort by</span>
              <button
                onClick={() => setSortBy((v) => (v === "date" ? "alphabetical" : "date"))}
                className="text-xs px-3 py-1 rounded-md bg-muted text-muted-foreground hover:bg-secondary font-medium transition-colors"
              >
                {sortBy === "date" ? "Date" : "A–Z"}
              </button>
            </div>
          </div>
        )}

        {/* Search — icon on right */}
        <div className="px-3 py-3">
          <div className="relative">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search picklists..."
              className="pr-8 h-9 text-sm bg-transparent border-0 focus-visible:ring-0 placeholder:text-muted-foreground"
            />
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1 px-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-xs text-muted-foreground">
              No picklists found
            </div>
          ) : (
            filtered.map((picklist) => {
              const isSelected = selectedId === picklist.id;
              const type = (picklist.type as PicklistType) || "private";
              return (
                <button
                  key={picklist.id}
                  onClick={() => handleSelect(picklist)}
                  className={[
                    "w-full text-left rounded-lg px-3 py-3 transition-colors border",
                    isSelected
                      ? "border-primary/60 bg-primary/5"
                      : "border-border hover:border-primary/30 hover:bg-secondary/30",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-3">
                    {/* ≡ icon in small bordered box */}
                    <div className="w-7 h-7 rounded-md border border-border bg-background flex items-center justify-center flex-shrink-0">
                      <AlignJustify className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Row 1: title + creator */}
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-primary leading-tight truncate">
                          {picklist.title || "Untitled"}
                        </span>
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {picklist.uname || "—"}
                        </span>
                      </div>
                      {/* Row 2: date + type */}
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-xs text-muted-foreground">
                          Created {formatTimestamp(picklist.timestamp)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          {type === "private" ? (
                            <Lock className="w-3 h-3" />
                          ) : (
                            <Globe className="w-3 h-3" />
                          )}
                          {TYPE_LABELS[type]}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Create button — bordered */}
        <div className="border-t border-border p-3">
          <button
            onClick={openCreateDialog}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors group"
          >
            <span className="text-primary font-medium">Create a new picklist</span>
            <div className="w-7 h-7 rounded-md border border-border bg-background flex items-center justify-center group-hover:border-primary/40 transition-colors">
              <PlusCircle className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </button>
        </div>
      </div>

      {/* ── Right panels ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center border-b border-border">
          <p className="text-sm text-primary">Choose a picklist to view team stats</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-primary">Choose a picklist to graph team data</p>
        </div>
      </div>

      {/* ── Create dialog ── */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="bg-muted border border-border text-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create New Picklist</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Title</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Picklist name..."
                className="bg-muted border-0"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Visibility</Label>
              <div className="flex gap-2">
                {TYPE_CYCLE.map((t) => (
                  <button
                    key={t}
                    onClick={() => setNewType(t)}
                    className={[
                      "flex-1 py-2 rounded-lg text-xs font-medium capitalize transition-colors",
                      newType === t
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newTitle.trim() || creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
