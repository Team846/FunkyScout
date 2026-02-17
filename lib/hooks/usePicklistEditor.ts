/**
 * Reusable picklist editor hook for drag-and-drop reordering and exclude/include toggling
 *
 * Used by both mobile and desktop picklist editors
 */

import { useState, useEffect, useRef } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";
import type { EventPicklistEntry } from "@lib/db";
import { updatePicklist } from "@lib/data/writes";

export interface PicklistEditorState {
  entries: EventPicklistEntry[];
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

  // Update entries when picklistId or data changes (for real-time updates)
  // BUT: Don't overwrite local changes if user has unsaved edits
  useEffect(() => {
    const currentHasChanges = JSON.stringify(entries) !== JSON.stringify(originalEntries);

    // Check if data actually changed (not just a re-render with same data)
    const dataChanged = JSON.stringify(initialEntries) !== JSON.stringify(originalEntries);

    // Only update if no unsaved changes OR if picklistId changed (different picklist entirely)
    const picklistIdChanged = entries.length > 0 && entries[0]?.team &&
      initialEntries.length > 0 && initialEntries[0]?.team &&
      entries[0].team !== initialEntries[0].team; // Rough heuristic for different picklist

    if (picklistIdChanged) {
      // Different picklist - always update
      setEntries(initialEntries);
      setOriginalEntries(initialEntries);
      setJustSaved(false);
    } else if (dataChanged) {
      // Skip notification if we just saved (this is likely our own change coming back)
      if (justSaved) {
        console.log("[usePicklistEditor] Skipping remote notification - just saved");
        setEntries(initialEntries);
        setOriginalEntries(initialEntries);
        setJustSaved(false);
      } else if (onRemoteChangesDetected) {
        // Same picklist, but remote data changed - notify the component
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
        setEntries(initialEntries);
        setOriginalEntries(initialEntries);
      }
    } else if (!currentHasChanges && !justSaved) {
      // No changes - auto-update
      setEntries(initialEntries);
      setOriginalEntries(initialEntries);
    } else {
      console.log("[usePicklistEditor] Ignoring remote update - unsaved local changes present");
    }
  }, [picklistId, JSON.stringify(initialEntries), onRemoteChangesDetected, justSaved]); // Update on picklistId OR when actual data changes

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
   */
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const displayEntries = excludedToBottom ? partitionExcluded(entries) : entries;
    const oldIndex = displayEntries.findIndex((e) => e.team === active.id);
    const newIndex = displayEntries.findIndex((e) => e.team === over.id);

    let reordered = arrayMove(displayEntries, oldIndex, newIndex).map((e, idx) => ({
      ...e,
      rank: idx + 1,
    }));

    // If partitioning, re-partition and update ranks
    if (excludedToBottom) {
      reordered = partitionExcluded(reordered).map((e, idx) => ({
        ...e,
        rank: idx + 1,
      }));
    }

    setEntries(reordered);
    // DON'T update originalEntries - this marks hasChanges = true
    console.log("[usePicklistEditor] Reordered (unsaved)");
  };

  /**
   * Toggle exclude flag for a team
   * DEBOUNCED: Marks as dirty, doesn't save immediately (call saveChanges() to persist)
   */
  const toggleExclude = async (teamKey: string) => {
    const updated = entries.map((e) =>
      e.team === teamKey
        ? { ...e, flags: { ...e.flags, excluded: !e.flags?.excluded } }
        : e
    );

    setEntries(updated);
    // DON'T update originalEntries - this marks hasChanges = true
    console.log("[usePicklistEditor] Toggled exclude (unsaved)");
  };

  /**
   * Save changes to database
   * This is the ONLY function that actually persists to Supabase
   */
  const saveChanges = async (): Promise<void> => {
    if (!hasChanges || isSaving) return;

    setIsSaving(true);

    try {
      // Ensure all entries have required fields
      const validEntries = entries.map((e) => ({
        team: e.team,
        rank: e.rank ?? 0,
        flags: e.flags ?? {},
      }));

      await updatePicklist(picklistId, eventKey, title, validEntries, type);

      // Update original to match current state (marks hasChanges = false)
      setOriginalEntries(entries);
      // Skip next remote change notification (likely our own save coming back)
      setJustSaved(true);

      console.log("[usePicklistEditor] ✅ Saved changes to Supabase");
      onSaveSuccess?.();
    } catch (error) {
      console.error("Failed to update picklist:", error);
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

  return {
    entries,
    hasChanges,
    isSaving,
    handleDragEnd,
    toggleExclude,
    saveChanges,
    resetChanges,
    setEntries,
  };
}
