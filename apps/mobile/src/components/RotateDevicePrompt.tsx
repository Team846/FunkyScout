import { Button } from "@shadcn/ui/components/button.tsx";

/**
 * Fullscreen prompt asking user to rotate their device.
 * Used for pages that require specific orientation.
 *
 * On Android PWA, rotation lock requires fullscreen and a user gesture.
 * Pass onRequestRotation (from useOrientation's requestFullscreenAndLock) to show
 * a "Tap to allow rotation" button so the user can enable landscape.
 */
export function RotateDevicePrompt({
  message = "This page works best in landscape mode for match scouting",
  onRequestRotation,
}: {
  message?: string;
  onRequestRotation?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/98 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 px-6">
        {/* Rotate phone icon with animation */}
        <div className="relative">
          <svg
            width="100"
            height="100"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-[#CDA745] animate-pulse"
          >
            {/* Phone outline */}
            <rect x="5" y="2" width="14" height="20" rx="2" />
            {/* Home button dot */}
            <circle cx="12" cy="19" r="0.5" fill="currentColor" />
          </svg>

          {/* Circular arrows indicating rotation */}
          <svg
            width="120"
            height="120"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="absolute -top-2 -left-2 text-[#CDA745]/60 animate-spin"
            style={{ animationDuration: "3s" }}
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </div>

        <div className="text-center">
          <p className="text-2xl font-semibold text-[#CDA745]">
            Please rotate your device
          </p>
          <p className="mt-3 text-base text-muted-foreground max-w-xs">
            {message}
          </p>
          {onRequestRotation && (
            <p className="mt-2 text-sm text-muted-foreground max-w-xs">
              On some devices (e.g. Android) you may need to tap below to allow rotation.
            </p>
          )}
        </div>

        {onRequestRotation && (
          <Button
            onClick={onRequestRotation}
            className="bg-[#CDA745] text-black hover:bg-[#CDA745]/90"
          >
            Tap to allow rotation
          </Button>
        )}
      </div>
    </div>
  );
}
