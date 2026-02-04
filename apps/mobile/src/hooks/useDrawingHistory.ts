import { useState, useCallback } from "react";
import type { Path } from "../components/auto-path-drawer/types";

interface UseDrawingHistoryReturn {
  paths: Path[];
  addPath: (path: Path) => void;
  undo: () => void;
  redo: () => void;
  eraseAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: (initialPaths: Path[]) => void;
}

export function useDrawingHistory(
  initialPaths: Path[] = []
): UseDrawingHistoryReturn {
  const [paths, setPaths] = useState<Path[]>(initialPaths);
  const [undoStack, setUndoStack] = useState<Path[][]>([]);
  const [redoStack, setRedoStack] = useState<Path[][]>([]);

  const addPath = useCallback(
    (path: Path) => {
      setUndoStack((prev) => [...prev, paths]);
      setRedoStack([]);
      setPaths((prev) => [...prev, path]);
    },
    [paths]
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;

    const previousState = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, paths]);
    setPaths(previousState);
    setUndoStack((prev) => prev.slice(0, -1));
  }, [paths, undoStack]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;

    const nextState = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, paths]);
    setPaths(nextState);
    setRedoStack((prev) => prev.slice(0, -1));
  }, [paths, redoStack]);

  const eraseAll = useCallback(() => {
    if (paths.length === 0) return;
    setUndoStack((prev) => [...prev, paths]);
    setRedoStack([]);
    setPaths([]);
  }, [paths]);

  const reset = useCallback((initialPaths: Path[]) => {
    setPaths(initialPaths);
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    paths,
    addPath,
    undo,
    redo,
    eraseAll,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    reset,
  };
}
