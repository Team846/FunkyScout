import { Button } from "@ui/components/ui/button";
import { Maximize, Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function MinimalToolbar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      className="w-full h-16 p-3.5 flex flex-row-reverse"
      data-tauri-drag-region
    >
      <Button variant="ghost" size="icon" onClick={() => appWindow.close()}>
        <X />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => appWindow.toggleMaximize()}
      >
        <Maximize />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => appWindow.minimize()}>
        <Minus />
      </Button>
    </div>
  );
}
