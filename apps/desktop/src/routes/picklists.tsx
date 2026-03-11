import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Search, Settings, Lock, Globe, AlignJustify } from "lucide-react";
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

// ─── Module-level UI state persistence (survives tab navigation) ─────────────
interface PicklistsUIState {
  sortBy: SortBy;
  showOnlyMine: boolean;
  search: string;
}
let _picklistsUIState: PicklistsUIState | null = null;

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
  const [showOnlyMine, setShowOnlyMine] = useState(() => _picklistsUIState?.showOnlyMine ?? false);
  const [defaultVisibility, setDefaultVisibility] = useState<PicklistType>("private");
  const [sortBy, setSortBy] = useState<SortBy>(() => _picklistsUIState?.sortBy ?? "date");

  // UI
  const [search, setSearch] = useState(() => _picklistsUIState?.search ?? "");
  // Persist UI state synchronously on every render
  _picklistsUIState = { sortBy, showOnlyMine, search };
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
    addTab("/picklist-open", picklist.title || "Untitled", { id: picklist.id }, `picklist-${picklist.id}`);
    navigate({ to: "/picklist-open", search: { id: picklist.id } });
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
      addTab("/picklist-open", newTitle.trim(), { id }, `picklist-${id}`);
      navigate({ to: "/picklist-open", search: { id } });
    } catch {
      toast.error("Failed to create picklist");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden p-3 gap-3">
      {/* ── Left Sidebar ── */}
      <div className="w-[260px] flex-shrink-0 flex flex-col bg-card border border-border rounded-lg overflow-hidden">

        {/* Header — bordered box */}
        <div className="px-3 pt-2 pb-1">
          <div className="flex items-center gap-2 px-3 py-2.5 border border-primary/50 rounded-lg">
            <AlignJustify className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-sm font-semibold text-foreground">Picklist Menu</span>
            <div className="flex-1" />
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className={[
                " rounded-md border transition-colors flex-shrink-0",
                settingsOpen
                  ? "border-muted bg-primary/10 text-primary"
                  : "border-muted text-muted-foreground hover:text-primary hover:bg-primary/5",
              ].join(" ")}
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Settings dropdown */}
        {settingsOpen && (
          <div className="mx-3 mb-2 px-4 py-3 space-y-2.5 bg-card border border-border rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Show only user picklists</span>
              <button
                onClick={() => setShowOnlyMine((v) => !v)}
                className={[
                  "text-xs px-3 py-1 rounded-md font-medium transition-colors border",
                  showOnlyMine
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border hover:border-primary/40",
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
                className="text-xs px-3 py-1 rounded-md bg-muted text-muted-foreground border border-border hover:border-primary/40 font-medium transition-colors"
              >
                {TYPE_LABELS[defaultVisibility]}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Sort by</span>
              <button
                onClick={() => setSortBy((v) => (v === "date" ? "alphabetical" : "date"))}
                className="text-xs px-3 py-1 rounded-md bg-muted text-muted-foreground border border-border hover:border-primary/40 font-medium transition-colors"
              >
                {sortBy === "date" ? "Date" : "A–Z"}
              </button>
            </div>
          </div>
        )}

        {/* Search — icon on right */}
        <div className="px-3 py-2">
          <div className="relative border border-border rounded-lg">
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
        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-2.5">
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
                    "w-full text-left rounded-lg px-3 py-3 transition-all border",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border/60 hover:border-primary ",
                  ].join(" ")}
                >
                  {/* Row 1: icon + title + creator */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlignJustify className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="text-sm font-semibold text-primary leading-tight truncate">
                        {picklist.title || "New Picklist"}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground/70 flex-shrink-0">
                      {picklist.uname || "—"}
                    </span>
                  </div>
                  {/* Row 2: date + type */}
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-muted-foreground/70">
                      Created {formatTimestamp(picklist.timestamp)}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
                      {TYPE_LABELS[type]}
                      {type === "private" ? (
                        <Lock className="w-3 h-3" />
                      ) : (
                        <Globe className="w-3 h-3" />
                      )}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Create button — bordered */}
        <div className="p-3">
          <button
            onClick={openCreateDialog}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors group border border-border rounded-lg hover:border-primary/40"
          >
            <span className="text-primary font-medium">Create a new picklist</span>
            <svg width="20" height="20" viewBox="0 0 29 29" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-muted-foreground group-hover:text-primary transition-colors">
              <g opacity="0.85">
                <path d="M22.1522 7.24996C23.3274 7.24996 24.4544 7.71679 25.2854 8.54776C26.1163 9.37872 26.5832 10.5058 26.5832 11.6809V22.1523C26.5832 23.3275 26.1163 24.4545 25.2854 25.2855C24.4544 26.1165 23.3274 26.5833 22.1522 26.5833H11.6808C10.5056 26.5833 9.3786 26.1165 8.54763 25.2855C7.71667 24.4545 7.24984 23.3275 7.24984 22.1523V11.6809C7.24984 10.5058 7.71667 9.37872 8.54763 8.54776C9.3786 7.71679 10.5056 7.24996 11.6808 7.24996H22.1522ZM16.9165 12.0833C16.596 12.0833 16.2887 12.2106 16.0621 12.4372C15.8355 12.6638 15.7082 12.9712 15.7082 13.2916V15.7083H13.2915C12.9955 15.7083 12.7099 15.817 12.4887 16.0137C12.2676 16.2103 12.1263 16.4813 12.0916 16.7753L12.0832 16.9166C12.0832 17.2371 12.2105 17.5444 12.4371 17.771C12.6637 17.9977 12.971 18.125 13.2915 18.125H15.7082V20.5416C15.7082 20.8376 15.8169 21.1232 16.0135 21.3444C16.2102 21.5656 16.4812 21.7069 16.7751 21.7415L16.9165 21.75C17.237 21.75 17.5443 21.6227 17.7709 21.396C17.9975 21.1694 18.1248 20.8621 18.1248 20.5416V18.125H20.5415C20.8375 18.1249 21.1231 18.0163 21.3443 17.8196C21.5655 17.6229 21.7068 17.3519 21.7414 17.058L21.7498 16.9166C21.7498 16.5962 21.6225 16.2888 21.3959 16.0622C21.1693 15.8356 20.862 15.7083 20.5415 15.7083H18.1248V13.2916C18.1248 12.9957 18.0161 12.71 17.8195 12.4888C17.6228 12.2677 17.3518 12.1264 17.0579 12.0918L16.9165 12.0833ZM18.1248 2.41663C19.4468 2.41663 20.3337 3.06067 20.9934 4.24604C21.0705 4.38473 21.1196 4.53725 21.1378 4.69489C21.1559 4.85253 21.1429 5.01221 21.0993 5.16481C21.0558 5.31741 20.9826 5.45993 20.884 5.58426C20.7854 5.70858 20.6633 5.81226 20.5246 5.88938C20.3859 5.96649 20.2334 6.01554 20.0757 6.03372C19.9181 6.05189 19.7584 6.03884 19.6058 5.9953C19.4532 5.95177 19.3107 5.8786 19.1864 5.77999C19.0621 5.68137 18.9584 5.55923 18.8813 5.42054C18.6142 4.93963 18.468 4.83329 18.1248 4.83329H6.0415C5.37934 4.83329 4.83317 5.37946 4.83317 6.04163V18.1225C4.83317 18.5092 5.01925 18.8693 5.32496 19.0953L5.4458 19.1738C5.58369 19.2523 5.70476 19.3573 5.8021 19.4826C5.89944 19.608 5.97114 19.7512 6.0131 19.9043C6.05506 20.0573 6.06647 20.2171 6.04667 20.3746C6.02688 20.5321 5.97626 20.6841 5.89771 20.822C5.81917 20.9599 5.71423 21.0809 5.58889 21.1783C5.46355 21.2756 5.32027 21.3473 5.16722 21.3893C5.01418 21.4312 4.85436 21.4426 4.69691 21.4228C4.53945 21.403 4.38744 21.3524 4.24955 21.2739C3.69324 20.9575 3.23061 20.4995 2.90865 19.9465C2.58669 19.3934 2.41689 18.7649 2.4165 18.125V6.04163C2.4165 4.04546 4.04534 2.41663 6.0415 2.41663H18.1248Z" fill="currentColor"/>
              </g>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Right panels ── */}
      <div className="flex-1 flex flex-col overflow-hidden gap-3">
        <div className="flex-[3] flex items-center justify-center border border-border rounded-lg">
          <p className="text-sm text-primary">Choose a picklist to view team stats</p>
        </div>
        <div className="flex-1 flex items-center justify-center border border-border rounded-lg">
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
