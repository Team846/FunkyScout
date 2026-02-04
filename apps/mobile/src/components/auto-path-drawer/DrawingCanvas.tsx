import { useRef, useEffect, useCallback, useState } from "react";
import type { Path, Point } from "./types";

const DRAWING_COLOR = "#737373"; // muted-foreground approximation
const LINE_WIDTH = 3;

interface DrawingCanvasProps {
  currentPaths: Path[];
  onPathComplete: (path: Path) => void;
  className?: string;
}

export function DrawingCanvas({
  currentPaths,
  onPathComplete,
  className = "",
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);

  // Setup canvas with proper sizing for retina displays
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();

      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, []);

  // Get normalized point from touch/mouse event
  const getNormalizedPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / rect.width,
        y: (clientY - rect.top) / rect.height,
      };
    },
    []
  );

  // Draw a single path on canvas
  const drawPath = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      path: Path,
      width: number,
      height: number
    ) => {
      if (path.points.length < 2) return;

      ctx.beginPath();
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const [first, ...rest] = path.points;
      ctx.moveTo(first.x * width, first.y * height);

      for (const point of rest) {
        ctx.lineTo(point.x * width, point.y * height);
      }

      ctx.stroke();
    },
    []
  );

  // Redraw all paths
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, width, height);

    // Draw all completed paths
    for (const path of currentPaths) {
      drawPath(ctx, path, width, height);
    }

    // Draw current path being drawn
    if (currentPath.length > 0) {
      drawPath(
        ctx,
        {
          points: currentPath,
          color: DRAWING_COLOR,
          lineWidth: LINE_WIDTH,
        },
        width,
        height
      );
    }
  }, [currentPaths, currentPath, drawPath]);

  // Redraw when paths change
  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Touch handlers
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const point = getNormalizedPoint(touch.clientX, touch.clientY);
      setIsDrawing(true);
      setCurrentPath([point]);
    },
    [getNormalizedPoint]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDrawing) return;
      e.preventDefault();
      const touch = e.touches[0];
      const point = getNormalizedPoint(touch.clientX, touch.clientY);
      setCurrentPath((prev) => [...prev, point]);
    },
    [isDrawing, getNormalizedPoint]
  );

  const handleTouchEnd = useCallback(() => {
    if (currentPath.length > 1) {
      onPathComplete({
        points: currentPath,
        color: DRAWING_COLOR,
        lineWidth: LINE_WIDTH,
      });
    }
    setIsDrawing(false);
    setCurrentPath([]);
  }, [currentPath, onPathComplete]);

  // Mouse handlers (for desktop testing)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const point = getNormalizedPoint(e.clientX, e.clientY);
      setIsDrawing(true);
      setCurrentPath([point]);
    },
    [getNormalizedPoint]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing) return;
      const point = getNormalizedPoint(e.clientX, e.clientY);
      setCurrentPath((prev) => [...prev, point]);
    },
    [isDrawing, getNormalizedPoint]
  );

  const handleMouseUp = useCallback(() => {
    if (currentPath.length > 1) {
      onPathComplete({
        points: currentPath,
        color: DRAWING_COLOR,
        lineWidth: LINE_WIDTH,
      });
    }
    setIsDrawing(false);
    setCurrentPath([]);
  }, [currentPath, onPathComplete]);

  const handleMouseLeave = useCallback(() => {
    if (isDrawing && currentPath.length > 1) {
      onPathComplete({
        points: currentPath,
        color: DRAWING_COLOR,
        lineWidth: LINE_WIDTH,
      });
    }
    setIsDrawing(false);
    setCurrentPath([]);
  }, [isDrawing, currentPath, onPathComplete]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full aspect-[3/2] bg-muted rounded-lg overflow-hidden ${className}`}
      style={{
        // Placeholder grid pattern for field map
        backgroundImage:
          "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
