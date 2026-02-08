import React, { useRef, useEffect, useCallback, useState } from "react";
import type { Path, Point } from "./types";
import red_field from "/red_field.svg";
import blue_field from "/blue_field.svg";

const DRAWING_COLOR = "#737373"; // muted-foreground approximation
const LINE_WIDTH = 3;

interface DrawingCanvasProps {
  currentPaths: Path[];
  onPathComplete: (path: Path) => void;
  className?: string;
  alliance?: "red" | "blue";
}

function DrawingCanvasComponent({
  currentPaths,
  onPathComplete,
  className = "",
  alliance = "red",
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);

  // Refs for stable access to state values in callbacks
  const isDrawingRef = useRef(isDrawing);
  const currentPathRef = useRef(currentPath);
  const currentPathsRef = useRef(currentPaths);
  const onPathCompleteRef = useRef(onPathComplete);

  // Keep refs in sync with state/props
  useEffect(() => {
    isDrawingRef.current = isDrawing;
  }, [isDrawing]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    currentPathsRef.current = currentPaths;
  }, [currentPaths]);

  useEffect(() => {
    onPathCompleteRef.current = onPathComplete;
  }, [onPathComplete]);

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
    [],
  );

  // Draw a single path on canvas
  const drawPath = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      path: Path,
      width: number,
      height: number,
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
    [],
  );

  // Redraw all paths - stabilized with refs to prevent render loops
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, width, height);

    // Draw all completed paths using ref
    for (const path of currentPathsRef.current) {
      drawPath(ctx, path, width, height);
    }

    // Draw current path being drawn using ref
    if (currentPathRef.current.length > 0) {
      drawPath(
        ctx,
        {
          points: currentPathRef.current,
          color: DRAWING_COLOR,
          lineWidth: LINE_WIDTH,
        },
        width,
        height,
      );
    }
  }, [drawPath]); // Only depends on drawPath (which is stable)

  // Redraw when paths change
  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Low-level touch handling - stabilized with refs to prevent listener re-registration
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animationFrameId: number | null = null;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const point = getNormalizedPoint(touch.clientX, touch.clientY);
      isDrawingRef.current = true;
      setIsDrawing(true);
      setCurrentPath([point]);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      const touch = e.touches[0];
      const point = getNormalizedPoint(touch.clientX, touch.clientY);

      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      animationFrameId = requestAnimationFrame(() => {
        setCurrentPath((prev) => {
          // Only add point if it's far enough from the last point
          // This reduces data size by ~90% and improves performance
          if (prev.length === 0) return [point];

          const last = prev[prev.length - 1];
          const distance = Math.sqrt(
            Math.pow(point.x - last.x, 2) + Math.pow(point.y - last.y, 2)
          );

          // Minimum distance threshold (normalized, ~5 pixels on a 300px canvas)
          const MIN_DISTANCE = 0.015;

          if (distance >= MIN_DISTANCE) {
            return [...prev, point];
          }
          return prev;
        });
        redrawCanvas();
      });
    };

    const onTouchEnd = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (currentPathRef.current.length > 1) {
        onPathCompleteRef.current({
          points: currentPathRef.current,
          color: DRAWING_COLOR,
          lineWidth: LINE_WIDTH,
        });
      }
      isDrawingRef.current = false;
      setIsDrawing(false);
      setCurrentPath([]);
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [getNormalizedPoint, redrawCanvas]); // Only stable dependencies

  // Mouse handlers (for desktop testing) - stabilized with refs
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const point = getNormalizedPoint(e.clientX, e.clientY);
      isDrawingRef.current = true;
      setIsDrawing(true);
      setCurrentPath([point]);
    },
    [getNormalizedPoint],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawingRef.current) return;
      const point = getNormalizedPoint(e.clientX, e.clientY);
      setCurrentPath((prev) => {
        // Only add point if it's far enough from the last point
        if (prev.length === 0) return [point];

        const last = prev[prev.length - 1];
        const distance = Math.sqrt(
          Math.pow(point.x - last.x, 2) + Math.pow(point.y - last.y, 2)
        );

        // Minimum distance threshold
        const MIN_DISTANCE = 0.015;

        if (distance >= MIN_DISTANCE) {
          return [...prev, point];
        }
        return prev;
      });
    },
    [getNormalizedPoint],
  );

  const handleMouseUp = useCallback(() => {
    if (currentPathRef.current.length > 1) {
      onPathCompleteRef.current({
        points: currentPathRef.current,
        color: DRAWING_COLOR,
        lineWidth: LINE_WIDTH,
      });
    }
    isDrawingRef.current = false;
    setIsDrawing(false);
    setCurrentPath([]);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (isDrawingRef.current && currentPathRef.current.length > 1) {
      onPathCompleteRef.current({
        points: currentPathRef.current,
        color: DRAWING_COLOR,
        lineWidth: LINE_WIDTH,
      });
    }
    isDrawingRef.current = false;
    setIsDrawing(false);
    setCurrentPath([]);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full aspect-[3/2] bg-muted rounded-xl overflow-hidden border border-border ${className}`}
    >
      <img
        src={alliance === "red" ? red_field : blue_field}
        alt="Field"
        className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}

// Wrap in React.memo to prevent unnecessary re-renders from parent
export const DrawingCanvas = React.memo(DrawingCanvasComponent);
