/**
 * TauriYouTubeEmbed
 *
 * YouTube iframes fail in Tauri production with Error 153 because the embedding
 * page's origin is `tauri://localhost`, which YouTube doesn't recognise.
 *
 * Fix: in Tauri, show the YouTube thumbnail with a play button. Clicking opens
 * the video in a WebviewWindow popup (separate OS window with its own origin),
 * which YouTube accepts. Falls back to a plain iframe in browser / dev mode.
 */

import { useCallback, useRef } from "react";
import { isTauri } from "@lib/utils/platform";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Play } from "lucide-react";

interface Props {
  youtubeId: string;
  /** Tailwind classes applied to the outer container */
  className?: string;
  /** Optional start time in seconds — appends &t=Xs to the YouTube URL */
  startTime?: number;
}

let popupCounter = 0;

export function TauriYouTubeEmbed({ youtubeId, className, startTime }: Props) {
  const popupRef = useRef<WebviewWindow | null>(null);

  const openPopup = useCallback(() => {
    popupRef.current?.close().catch(() => {});

    const label = `match-video-${++popupCounter}`;
    const url = startTime != null
      ? `https://www.youtube.com/watch?v=${youtubeId}&t=${startTime}s`
      : `https://www.youtube.com/watch?v=${youtubeId}`;
    try {
      const win = new WebviewWindow(label, {
        url,
        title: "Match Video",
        width: 1280,
        height: 720,
        resizable: true,
        center: true,
      });
      win.once("tauri://created", () => {});
      win.once("tauri://error", () => {});
      popupRef.current = win;
    } catch {}
  }, [youtubeId, startTime]);

  if (!isTauri()) {
    // Browser / dev mode: plain iframe works fine.
    const iframeSrc = startTime != null
      ? `https://www.youtube-nocookie.com/embed/${youtubeId}?start=${startTime}`
      : `https://www.youtube-nocookie.com/embed/${youtubeId}`;
    return (
      <iframe
        key={youtubeId}
        title="Match video"
        src={iframeSrc}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className={`absolute inset-0 w-full h-full ${className ?? ""}`}
      />
    );
  }

  // Tauri: show thumbnail + play button, click opens a WebviewWindow popup.
  const thumbnailUrl = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;

  return (
    <button
      type="button"
      onClick={openPopup}
      className={`absolute inset-0 w-full h-full bg-black flex items-center justify-center group overflow-hidden ${className ?? ""}`}
      title="Watch video"
    >
      <img
        src={thumbnailUrl}
        alt="Video thumbnail"
        className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:opacity-60 transition-opacity"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="relative z-10 rounded-full bg-black/70 p-4 group-hover:bg-black/90 transition-colors">
        <Play className="w-8 h-8 text-white fill-white" />
      </div>
    </button>
  );
}
