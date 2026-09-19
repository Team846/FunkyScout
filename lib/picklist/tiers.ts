/** Max tier rank shown in the picklist tier picker (1 = best). */
export const PICKLIST_TIER_MAX = 5;

/** Border colors for tiers (not Tailwind classes — lib/ is outside default @source). */
export const PICKLIST_TIER_BORDER_COLOR: Record<number, string> = {
  1: "#fbbf24", // amber-400
  2: "#10b981", // emerald-500
  3: "#0ea5e9", // sky-500
  4: "#8b5cf6", // violet-500
  5: "#94a3b8", // slate-400
};

export function getPicklistEntryTier(
  flags: Record<string, unknown> | null | undefined,
): number | null {
  const raw = flags?.tier;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= PICKLIST_TIER_MAX) {
    return Math.trunc(n);
  }
  return null;
}

export function picklistTierBorderStyle(
  tier: number | null,
): { borderColor: string; borderWidth: number; borderStyle: "solid" } | undefined {
  if (tier === null) return undefined;
  const borderColor = PICKLIST_TIER_BORDER_COLOR[tier];
  if (!borderColor) return undefined;
  return { borderColor, borderWidth: 2, borderStyle: "solid" };
}

export function picklistTeamCardBorderClasses(
  tier: number | null,
  options: { isSelected: boolean; isExcluded?: boolean },
): string {
  if (tier !== null) {
    return "border-solid";
  }
  if (options.isSelected) {
    return "border-primary";
  }
  return "border-border/60 hover:border-muted-foreground";
}
