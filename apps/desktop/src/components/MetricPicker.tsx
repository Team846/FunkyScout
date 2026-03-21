import { useState, useMemo } from "react";
import { X, Search } from "lucide-react";
import { GRAPHABLE_STATS } from "@lib/data/matchStats";

const EXTRA_GRAPH_METRICS = [
  { key: "epa", label: "EPA", group: "TBA" as const },
  { key: "opr", label: "OPR", group: "TBA" as const },
];

export const OVERVIEW_METRIC = { key: "overview", label: "Overview", group: "Overview" as const };

export const ALL_GRAPH_METRICS = [
  OVERVIEW_METRIC,
  ...EXTRA_GRAPH_METRICS,
  ...GRAPHABLE_STATS.map((s) => ({ key: s.key, label: s.label, group: s.group })),
];

export interface MetricPickerProps {
  activeMetrics: string[];
  onSelect: (key: string) => void;
  onClose: () => void;
}

export function MetricPicker({ activeMetrics, onSelect, onClose }: MetricPickerProps) {
  const [search, setSearch] = useState("");

  const filteredMetrics = useMemo(() => {
    if (!search.trim()) return ALL_GRAPH_METRICS;
    const q = search.toLowerCase();
    return ALL_GRAPH_METRICS.filter(
      (m) => m.label.toLowerCase().includes(q) || m.group.toLowerCase().includes(q)
    );
  }, [search]);

  const filteredGroups = [...new Set(filteredMetrics.map((m) => m.group))];

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 bg-muted border border-border rounded-lg shadow-xl z-50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Select Metric</span>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search metrics..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              autoFocus
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto py-2">
          {filteredGroups.length === 0 ? (
            <div className="px-4 py-4 text-sm text-muted-foreground text-center">
              No metrics found
            </div>
          ) : (
            filteredGroups.map((group) => (
              <div key={group}>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {group}
                </div>
                {filteredMetrics
                  .filter((m) => m.group === group)
                  .map((metric) => {
                    const isActive = activeMetrics.includes(metric.key);
                    return (
                      <button
                        key={metric.key}
                        onClick={() => !isActive && onSelect(metric.key)}
                        className={[
                          "w-full text-left px-5 py-2 text-sm transition-colors",
                          isActive
                            ? "text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-card cursor-pointer",
                        ].join(" ")}
                      >
                        {metric.label}
                        {isActive && " ✓"}
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
