/**
 * Reusable picklist editor hook for drag-and-drop reordering and exclude/include toggling
 *
 * Used by both mobile and desktop picklist editors
 */

import { useState, useEffect } from "react";
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
  } = options;

  const [entries, setEntries] = useState<EventPicklistEntry[]>(initialEntries);
  const [originalEntries, setOriginalEntries] = useState<EventPicklistEntry[]>(initialEntries);
  const [isSaving, setIsSaving] = useState(false);

  // Update entries when picklistId or data changes (for real-time updates)
  useEffect(() => {
    setEntries(initialEntries);
    setOriginalEntries(initialEntries);
  }, [picklistId, JSON.stringify(initialEntries)]); // Update on picklistId OR when actual data changes

  // Check if there are unsaved changes
  const hasChanges = JSON.stringify(entries) !== JSON.stringify(originalEntries);

  /**
   * Handle drag-and-drop reordering
   * Saves immediately for real-time sync across devices
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
    setOriginalEntries(reordered); // Update original to prevent "unsaved changes" state

    // Save immediately for real-time sync
    try {
      const validEntries = reordered.map((e) => ({
        team: e.team,
        rank: e.rank ?? 0,
        flags: e.flags ?? {},
      }));

      await updatePicklist(picklistId, eventKey, title, validEntries, type);
    } catch (error) {
      console.error("Failed to save picklist reorder:", error);
      // Revert on error
      setEntries(originalEntries);
    }
  };

  /**
   * Toggle exclude flag for a team
   * Saves immediately for real-time sync across devices
   */
  const toggleExclude = async (teamKey: string) => {
    const updated = entries.map((e) =>
      e.team === teamKey
        ? { ...e, flags: { ...e.flags, excluded: !e.flags?.excluded } }
        : e
    );

    setEntries(updated);
    setOriginalEntries(updated); // Update original to prevent "unsaved changes" state

    // Save immediately for real-time sync
    try {
      const validEntries = updated.map((e) => ({
        team: e.team,
        rank: e.rank ?? 0,
        flags: e.flags ?? {},
      }));

      await updatePicklist(picklistId, eventKey, title, validEntries, type);
    } catch (error) {
      console.error("Failed to save picklist exclude:", error);
      // Revert on error
      setEntries(originalEntries);
    }
  };

  /**
   * Save changes to database
   */
  const saveChanges = async (): Promise<void> => {
    if (!hasChanges) return;

    setIsSaving(true);

    try {
      // Ensure all entries have required fields
      const validEntries = entries.map((e) => ({
        team: e.team,
        rank: e.rank ?? 0,
        flags: e.flags ?? {},
      }));

      await updatePicklist(picklistId, eventKey, title, validEntries, type);

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
