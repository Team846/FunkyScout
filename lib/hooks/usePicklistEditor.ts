/**
 * Reusable picklist editor hook for drag-and-drop reordering and exclude/include toggling
 *
 * Used by both mobile and desktop picklist editors
 */

import { useState, useEffect, useRef } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";
import type { PicklistEntry as EventPicklistEntry } from "@lib/data/schema";
import { updatePicklist } from "@lib/data/writes";

export interface PicklistEditorState {
  entries: EventPicklistEntry[];
  displayEntries: EventPicklistEntry[]; // For rendering only (partitioned if excludedToBottom)
  hasChanges: boolean;
  isSaving: boolean;
}

export interface PicklistEditorActions {
  handleDragEnd: (event: DragEndEvent) => void;
  toggleExclude: (teamKey: string) => void;
  saveChanges: () => Promise<void>;
  resetChanges: () => void;
  setEntries: (entries: EventPicklistEntry[]) => void;
}

export interface UsePicklistEditorOptions {
  initialEntries: EventPicklistEntry[];
  picklistId: string;
  eventKey: string;
  title: string;
  type?: "public" | "private" | "default";
  excludedToBottom?: boolean; // Whether to partition excluded items to bottom
  onSaveSuccess?: () => void;
  onSaveError?: (error: Error) => void;
  onRemoteChangesDetected?: (hasUnsavedChanges: boolean, acceptChanges: () => void, rejectChanges: () => void) => void;
}

/**
 * Helper to partition entries into included (top) and excluded (bottom)
 */
function partitionExcluded(entries: EventPicklistEntry[]): EventPicklistEntry[] {
  const included = entries.filter((e) => !e.flags?.excluded);
  const excluded = entries.filter((e) => e.flags?.excluded);
  return [...included, ...excluded];
}

export function usePicklistEditor(
  options: UsePicklistEditorOptions
): PicklistEditorState & PicklistEditorActions {
  const {
    initialEntries,
    picklistId,
    eventKey,
    title,
    type,
    excludedToBottom = false,
    onSaveSuccess,
    onSaveError,
    onRemoteChangesDetected,
  } = options;

  const [entries, setEntries] = useState<EventPicklistEntry[]>(initialEntries);
  const [originalEntries, setOriginalEntries] = useState<EventPicklistEntry[]>(initialEntries);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false); // Skip next remote update notification after save
  const [lastPicklistId, setLastPicklistId] = useState<string>(picklistId); // Track picklist ID changes
  const [saveTimestamp, setSaveTimestamp] = useState<number>(0); // Track when we last saved

  // Update entries when picklistId or data changes (for real-time updates)
  // BUT: Don't overwrite local changes if user has unsaved edits
  useEffect(() => {
    const currentHasChanges = JSON.stringify(entries) !== JSON.stringify(originalEntries);

    // Check if data actually changed (not just a re-render with same data)
    const dataChanged = JSON.stringify(initialEntries) !== JSON.stringify(originalEntries);

    // Check if we switched to a different picklist (use actual picklistId, not team order)
    const picklistIdChanged = picklistId !== lastPicklistId;

    // Ignore updates for 5 seconds after save to prevent race conditions
    const timeSinceSave = Date.now() - saveTimestamp;
    const inSaveGracePeriod = saveTimestamp > 0 && timeSinceSave < 5000;

    console.log("[usePicklistEditor] useEffect triggered:", {
      picklistId,
      lastPicklistId,
      currentHasChanges,
      dataChanged,
      picklistIdChanged,
      justSaved,
      inSaveGracePeriod,
      timeSinceSave,
      entriesCount: entries.length,
      initialEntriesCount: initialEntries.length,
      entriesFirstExcluded: entries[0]?.flags?.excluded,
      initialEntriesFirstExcluded: initialEntries[0]?.flags?.excluded,
    });

    if (picklistIdChanged) {
      // Different picklist - always update
      console.log("[usePicklistEditor] Different picklist - updating entries");
      setEntries(initialEntries);
      setOriginalEntries(initialEntries);
      setJustSaved(false);
      setSaveTimestamp(0);
      setLastPicklistId(picklistId);
    } else if (dataChanged) {
      // Ignore updates during save grace period (prevents race conditions)
      if (inSaveGracePeriod) {
        console.log("[usePicklistEditor] ⏸️ Ignoring update - within 5s grace period after save");
        return;
      }

      // Skip notification if we just saved (this is likely our own change coming back)
      if (justSaved) {
        console.log("[usePicklistEditor] Just saved - accepting remote data");
        setEntries(initialEntries);
        setOriginalEntries(initialEntries);
        setJustSaved(false);
      } else if (onRemoteChangesDetected) {
        // Same picklist, but remote data changed - notify the component
        console.log("[usePicklistEditor] Remote changes detected - notifying component");
        const acceptChanges = () => {
          setEntries(initialEntries);
          setOriginalEntries(initialEntries);
        };
        const rejectChanges = () => {
          // Keep current entries, mark as having changes
          setOriginalEntries(initialEntries); // Update original so hasChanges will be true
        };
        onRemoteChangesDetected(currentHasChanges, acceptChanges, rejectChanges);
      } else if (!currentHasChanges) {
        // No unsaved changes and no callback - auto-update
        console.log("[usePicklistEditor] No unsaved changes - auto-updating");
        setEntries(initialEntries);
        setOriginalEntries(initialEntries);
      }
    } else if (!currentHasChanges && !justSaved) {
      // No changes - auto-update
      console.log("[usePicklistEditor] No changes - auto-updating");
      setEntries(initialEntries);
      setOriginalEntries(initialEntries);
    } else {
      console.log("[usePicklistEditor] Ignoring remote update - unsaved local changes present");
    }
  }, [picklistId, JSON.stringify(initialEntries), onRemoteChangesDetected, justSaved, saveTimestamp]); // Update on picklistId OR when actual data changes

  // Auto-save on unmount if there are unsaved changes
  // Use refs to avoid re-running cleanup on every state change
  const entriesRef = useRef(entries);
  const originalEntriesRef = useRef(originalEntries);

  useEffect(() => {
    entriesRef.current = entries;
    originalEntriesRef.current = originalEntries;
  });

  useEffect(() => {
    // Cleanup only runs on actual unmount (no dependencies)
    return () => {
      const currentHasChanges = JSON.stringify(entriesRef.current) !== JSON.stringify(originalEntriesRef.current);
      if (currentHasChanges) {
        console.log("[usePicklistEditor] Component unmounting with unsaved changes, auto-saving...");

        // Fire-and-forget save on unmount
        const validEntries = entriesRef.current.map((e) => ({
          team: e.team,
          rank: e.rank ?? 0,
          flags: e.flags ?? {},
        }));

        updatePicklist(picklistId, eventKey, title, validEntries, type)
          .then(() => {
            console.log("[usePicklistEditor] ✅ Auto-saved on unmount");
          })
          .catch((error) => {
            console.error("[usePicklistEditor] Auto-save failed:", error);
          });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps = cleanup only on unmount

  // Check if there are unsaved changes
  const hasChanges = JSON.stringify(entries) !== JSON.stringify(originalEntries);

  /**
   * Handle drag-and-drop reordering
   * DEBOUNCED: Marks as dirty, doesn't save immediately (call saveChanges() to persist)
   *
   * When excludedToBottom=true, dragging only reorders within the same section
   * (included-only or excluded-only). Ranks of the other section are NOT affected.
   */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    if (excludedToBottom) {
      const included = entries.filter((e) => !e.flags?.excluded);
      const excluded = entries.filter((e) => e.flags?.excluded);

      const activeInIncluded = included.some((e) => e.team === active.id);
      const overInIncluded = included.some((e) => e.team === over.id);

      if (activeInIncluded && overInIncluded) {
        // Drag within included section only — excluded ranks are NOT touched
        const oldIndex = included.findIndex((e) => e.team === active.id);
        const newIndex = included.findIndex((e) => e.team === over.id);
        const reorderedIncluded = arrayMove(included, oldIndex, newIndex).map((e, idx) => ({
          ...e,
          rank: idx + 1,
        }));
        // excluded keeps original ranks — excludedToBottom is UI-only
        setEntries([...reorderedIncluded, ...excluded]);
      } else if (!activeInIncluded && !overInIncluded) {
        // Drag within excluded section only
        const oldIndex = excluded.findIndex((e) => e.team === active.id);
        const newIndex = excluded.findIndex((e) => e.team === over.id);
        const reorderedExcluded = arrayMove(excluded, oldIndex, newIndex).map((e, idx) => ({
          ...e,
          rank: included.length + idx + 1,
        }));
        setEntries([...included, ...reorderedExcluded]);
      }
      // Cross-section drag: ignore (can't drop included into excluded section or vice versa)
    } else {
      const oldIndex = entries.findIndex((e) => e.team === active.id);
      const newIndex = entries.findIndex((e) => e.team === over.id);
      const reordered = arrayMove(entries, oldIndex, newIndex).map((e, idx) => ({
        ...e,
        rank: idx + 1,
      }));
      setEntries(reordered);
    }

    // DON'T update originalEntries - this marks hasChanges = true
    console.log("[usePicklistEditor] Reordered (unsaved)");
  };

  /**
   * Toggle exclude flag for a team
   * DEBOUNCED: Marks as dirty, doesn't save immediately (call saveChanges() to persist)
   */
  const toggleExclude = async (teamKey: string) => {
    const beforeExcluded = entries.find(e => e.team === teamKey)?.flags?.excluded;

    // Only toggle the flag — excludedToBottom is UI-only, ranks are preserved
    const updated = entries.map((e) =>
      e.team === teamKey
        ? { ...e, flags: { ...e.flags, excluded: !e.flags?.excluded } }
        : e
    );

    console.log("[usePicklistEditor] Toggling exclude:", {
      team: teamKey,
      beforeExcluded,
      afterExcluded: !beforeExcluded,
      excludedToBottom,
    });

    setEntries(updated);
    // DON'T update originalEntries - this marks hasChanges = true
    console.log("[usePicklistEditor] ✓ Toggled exclude (unsaved)");
  };

  /**
   * Save changes to database
   * This is the ONLY function that actually persists to Supabase
   */
  const saveChanges = async (): Promise<void> => {
    if (!hasChanges || isSaving) return;

    console.log("[usePicklistEditor] 💾 Starting save:", {
      picklistId,
      eventKey,
      title,
      entriesCount: entries.length,
      firstEntryExcluded: entries[0]?.flags?.excluded,
    });

    setIsSaving(true);

    try {
      // Ensure all entries have required fields
      const validEntries = entries.map((e) => ({
        team: e.team,
        rank: e.rank ?? 0,
        flags: e.flags ?? {},
      }));

      console.log("[usePicklistEditor] Calling updatePicklist...");
      await updatePicklist(picklistId, eventKey, title, validEntries, type);
      console.log("[usePicklistEditor] updatePicklist returned");

      const now = Date.now();
      // Update original to match current state (marks hasChanges = false)
      setOriginalEntries(entries);
      // Skip next remote change notification (likely our own save coming back)
      setJustSaved(true);
      // Track save time to ignore older remote updates
      setSaveTimestamp(now);

      console.log("[usePicklistEditor] ✅ Save complete - justSaved flag set, saveTimestamp:", now);
      onSaveSuccess?.();
    } catch (error) {
      console.error("[usePicklistEditor] ❌ Save failed:", error);
      onSaveError?.(error as Error);
      // Revert on error
      setEntries(originalEntries);
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Reset to original state
   */
  const resetChanges = () => {
    setEntries(originalEntries);
  };

  // Get display entries (for UI only - doesn't affect saved ranks)
  const displayEntries = excludedToBottom ? partitionExcluded(entries) : entries;

  return {
    entries,
    displayEntries,
    hasChanges,
    isSaving,
    handleDragEnd,
    toggleExclude,
    saveChanges,
    resetChanges,
    setEntries,
  };
}
