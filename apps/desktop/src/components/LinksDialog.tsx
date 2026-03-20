import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shadcn/ui/components/dialog.tsx";
import { useDesktopEvent } from "../contexts/DesktopEventContext";

interface LinksDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function buildLinks(eventKey: string | null) {
  if (!eventKey) return [];
  // eventKey format: "2026orsal" — year is first 4 chars, code is the rest
  const year2 = eventKey.substring(2, 4);
  const code = eventKey.substring(4);
  return [
    {
      label: "TBA Schedule",
      description: "The Blue Alliance — Event Schedule",
      href: `https://www.thebluealliance.com/event/${eventKey}`,
    },
    {
      label: "TBA Rankings",
      description: "The Blue Alliance — Event Rankings",
      href: `https://www.thebluealliance.com/event/${eventKey}#rankings`,
    },
    {
      label: "FunkyStats",
      description: "Team 846 custom scouting stats app",
      href: `https://fsm846.netlify.app/event${year2}/${code}`,
    },
    {
      label: "Statbotics",
      description: "Statbotics — Event Statistics",
      href: `https://www.statbotics.io/event/${eventKey}`,
    },
  ];
}

export function LinksDialog({ open, onOpenChange }: LinksDialogProps) {
  const { currentEvent } = useDesktopEvent();
  const links = buildLinks(currentEvent);

  const handleOpen = (href: string) => {
    openUrl(href).catch(() => {});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col gap-0 p-0 bg-background border-border">
        <DialogHeader className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-border">
          <DialogTitle className="text-base">Quick Links</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto min-h-0 p-2 max-h-[60vh]">
          <div className="grid gap-1.5">
            {links.map((link) => (
              <button
                key={link.href}
                type="button"
                onClick={() => handleOpen(link.href)}
                className="text-left p-3 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-primary/50 transition-colors flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-semibold text-primary text-sm">
                    {link.label}
                  </div>
                  <div className="text-xs mt-0.5 text-muted-foreground">
                    {link.description}
                  </div>
                </div>
                <ExternalLink className="size-4 text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
