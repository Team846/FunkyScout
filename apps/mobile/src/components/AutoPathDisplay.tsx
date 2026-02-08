import type { DrawingData } from "./auto-path-drawer/types";

interface AutoPathDisplayProps {
  drawing: DrawingData;
  className?: string;
}

/**
 * Displays a saved auto path drawing as an SVG
 * More performant than canvas for static display
 */
export function AutoPathDisplay({ drawing, className }: AutoPathDisplayProps) {
  const { paths, canvasWidth, canvasHeight } = drawing;

  // Use a fixed display size but maintain aspect ratio
  const displayWidth = 300;
  const displayHeight = 300;

  return (
    <svg
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      className={className}
      style={{ width: displayWidth, height: displayHeight }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background */}
      <rect width={canvasWidth} height={canvasHeight} fill="transparent" />

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
  );
}
