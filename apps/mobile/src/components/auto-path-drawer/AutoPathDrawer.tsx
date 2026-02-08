import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import { DrawingCanvas } from "./DrawingCanvas";
import { useDrawingHistory } from "../../hooks/useDrawingHistory";
import type { DrawingData } from "./types";

interface AutoPathDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoIndex: number;
  initialDrawing: DrawingData | null;
  onSave: (drawing: DrawingData) => void;
}

export function AutoPathDrawer({
  open,
  onOpenChange,
  autoIndex,
  initialDrawing,
  onSave,
}: AutoPathDrawerProps) {
  const { paths, addPath, undo, redo, eraseAll, canUndo, canRedo, reset } =
    useDrawingHistory(initialDrawing?.paths || []);

  // Reset when dialog opens with new data
  useEffect(() => {
    if (open) {
      reset(initialDrawing?.paths || []);
    }
  }, [open, initialDrawing, reset]);

  const handleSave = () => {
    onSave({
      paths,
      canvasWidth: 300, // Reference width
      canvasHeight: 200, // Reference height
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[90vw] max-h-[85vh] p-4 flex flex-col gap-4"
        showCloseButton={false}
        style={{
          transitionDuration: "150ms",
          willChange: "transform",
        }}
      >
        {/* Custom close button - top left */}
        <DialogClose className="absolute top-4 left-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <svg
            viewBox="0 0 24 24"
            className="size-5 text-muted-foreground"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M18 6L6 18M6 6L18 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sr-only">Close</span>
        </DialogClose>

        {/* Title - offset for close button */}
        <DialogHeader className="pl-8">
          <DialogTitle>Auto {autoIndex} Path</DialogTitle>
        </DialogHeader>

        {/* Drawing canvas */}
        <DrawingCanvas currentPaths={paths} onPathComplete={addPath} />

        {/* Toolbar */}
        <div className="flex justify-between items-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={eraseAll}
            className="text-destructive border-destructive/50 hover:bg-destructive/10 hover:text-muted-foreground"
          >
            Erase All
          </Button>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={undo}
              disabled={!canUndo}
              className="px-3"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 10H16C18.7614 10 21 12.2386 21 15C21 17.7614 18.7614 20 16 20H11"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M7 6L3 10L7 14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={redo}
              disabled={!canRedo}
              className="px-3"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M21 10H8C5.23858 10 3 12.2386 3 15C3 17.7614 5.23858 20 8 20H13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M17 6L21 10L17 14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
          </div>

          <Button variant="default" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
