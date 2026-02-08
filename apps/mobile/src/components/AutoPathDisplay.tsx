import type { DrawingData } from "./auto-path-drawer/types";
import red_field from "/red_field.svg";
import blue_field from "/blue_field.svg";

interface AutoPathDisplayProps {
  drawing: DrawingData;
  alliance?: "red" | "blue";
  className?: string;
}

/**
 * Displays a saved auto path drawing over the field graphic
 * More performant than canvas for static display
 */
export function AutoPathDisplay({
  drawing,
  alliance = "red",
  className,
}: AutoPathDisplayProps) {
  const { paths, canvasWidth, canvasHeight } = drawing;

  return (
    <div className={`relative inline-block ${className || ""}`}>
      {/* Field background image */}
      <img
        src={alliance === "red" ? red_field : blue_field}
        alt="Field"
        className="w-full h-auto max-w-[300px]"
      />

      {/* SVG overlay for paths */}
      <svg
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
        style={{ pointerEvents: "none" }}
      >
        {/* Render each path */}
        {paths.map((path, pathIndex) => {
          if (path.points.length < 2) return null;

          // Convert normalized points to actual coordinates
          const actualPoints = path.points.map((p) => ({
            x: p.x * canvasWidth,
            y: p.y * canvasHeight,
          }));

          // Create SVG path data
          const pathData = actualPoints
            .map((point, i) => {
              if (i === 0) return `M ${point.x} ${point.y}`;
              return `L ${point.x} ${point.y}`;
            })
            .join(" ");

          return (
            <path
              key={pathIndex}
              d={pathData}
              stroke={path.color}
              strokeWidth={path.lineWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    </div>
  );
}
