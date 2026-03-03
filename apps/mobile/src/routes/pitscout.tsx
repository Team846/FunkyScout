import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Toggle } from "@shadcn/ui/components/toggle.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Textarea } from "@shadcn/ui/components/textarea.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@shadcn/ui/components/collapsible.tsx";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@shadcn/ui/components/popover.tsx";
import {
  Dialog,
  DialogContent,
} from "@shadcn/ui/components/dialog.js";
import { AutoPathDrawer } from "../components/auto-path-drawer/AutoPathDrawer";
import type {
  AutoEntry,
  DrawingData,
} from "../components/auto-path-drawer/types";
import { usePitScoutForm } from "@lib/context/PitScoutFormContext";
import { toast } from "sonner";

type ScoutSearch = {
  teamNum?: number;
  teamName?: string;
};

export const Route = createFileRoute("/pitscout")({
  component: ScoutPage,
  validateSearch: (search: Record<string, unknown>): ScoutSearch => {
    return {
      teamNum: search.teamNum as number | undefined,
      teamName: search.teamName as string | undefined,
    };
  },
});

// Info icon with popover — uses <span> to avoid nested <button> error
function InfoButton({ info }: { info?: string }) {
  if (!info) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
          }}
          className="flex items-center justify-center cursor-pointer"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4 text-muted-foreground"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M12 16V12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="12" cy="8" r="1" fill="currentColor" />
          </svg>
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-48 text-sm bg-card">
        <p className="text-muted-foreground">{info}</p>
      </PopoverContent>
    </Popover>
  );
}

// Custom toggle button with yellow border when active
function ScoutToggle({
  children,
  pressed,
  onPressedChange,
  className = "",
  info,
}: {
  children: React.ReactNode;
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  className?: string;
  info?: string;
}) {
  return (
    <Toggle
      pressed={pressed}
      onPressedChange={onPressedChange}
      className={`h-10 px-4 rounded-lg border border-border bg-background text-foreground font-light data-[state=on]:border-primary data-[state=on]:border-2 data-[state=on]:text-primary hover:bg-background ${className}`}
    >
      {children}
      <InfoButton info={info} />
    </Toggle>
  );
}

// Collapsible section component
function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-primary text-md font-light">
        <span>{title}</span>
        <svg
          viewBox="0 0 24 24"
          className={`size-5 text-muted-foreground transition-transform ${isOpen ? "" : "rotate-180"}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M18 15L12 9L6 15"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

// Autos section with plus/minus buttons to add/remove entries
function AutosSection({
  entries,
  setEntries,
}: {
  entries: AutoEntry[];
  setEntries: React.Dispatch<React.SetStateAction<AutoEntry[]>>;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAutoId, setEditingAutoId] = useState<number | null>(null);

  const addEntry = () => {
    const newId = Date.now();
    setEntries([
      ...entries,
      { id: newId, climb: false, drawing: null, name: `Auto ${entries.length + 1}`, description: "" },
    ]);
    // Open drawer for new entry
    setEditingAutoId(newId);
    setDrawerOpen(true);
  };

  const removeEntry = () => {
    if (entries.length > 0) {
      setEntries(entries.slice(0, -1));
    }
  };

  const toggleClimb = (id: number, pressed: boolean) => {
    setEntries(
      entries.map((e) => (e.id === id ? { ...e, climb: pressed } : e))
    );
  };

  const updateName = (id: number, name: string) => {
    setEntries(entries.map((e) => (e.id === id ? { ...e, name } : e)));
  };

  const updateDescription = (id: number, description: string) => {
    setEntries(entries.map((e) => (e.id === id ? { ...e, description } : e)));
  };

  const handleSaveDrawing = (drawing: DrawingData) => {
    setEntries(
      entries.map((e) => (e.id === editingAutoId ? { ...e, drawing } : e))
    );
  };

  const editingEntry = entries.find((e) => e.id === editingAutoId);
  const editingIndex = entries.findIndex((e) => e.id === editingAutoId) + 1;

  return (
    <div className="flex flex-col gap-3 ">
      <div className="flex items-center gap-2">
        <span className="text-md text-primary font-light ">Autos</span>
        <button
          onClick={addEntry}
          className="flex items-center text-muted-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M12 8V16M8 12H16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          onClick={removeEntry}
          className="flex items-center text-muted-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M8 12H16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div className=" px-2 flex flex-col gap-3">
        {entries.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={entry.name || ""}
                onChange={(e) => updateName(entry.id, e.target.value)}
                className="h-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
                placeholder="Auto name"
              />
              <ScoutToggle
                pressed={entry.climb}
                onPressedChange={(p) => toggleClimb(entry.id, p)}
                className="w-full"
                info="Climbs during this specific auto"
              >
                Climb
              </ScoutToggle>
            </div>
            <Textarea
              value={entry.description || ""}
              onChange={(e) => updateDescription(entry.id, e.target.value)}
              className="min-h-20 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
              placeholder="Description (optional)"
            />
          </div>
        ))}
      </div>

      {/* Drawing Dialog */}
      <AutoPathDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        autoIndex={editingIndex}
        initialDrawing={editingEntry?.drawing || null}
        onSave={handleSaveDrawing}
      />
    </div>
  );
}

function ScoutPage() {
  const navigate = useNavigate();
  const { teamNum, teamName } = Route.useSearch();
  const { formData, setFormData } = usePitScoutForm();
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  /* GENERATED:STATE:START */
  // Movement state
  const [movementBump, setMovementBump] = useState(false);
  const [movementTrough, setMovementTrough] = useState(false);

  // Intake state
  const [intakeGround, setIntakeGround] = useState(false);
  const [intakeOutpost, setIntakeOutpost] = useState(false);

  // Fuel state
  const [fuelPassing, setFuelPassing] = useState(false);
  const [fuelCapacity, setFuelCapacity] = useState<string>("");

  // Auto Climb state
  const [autoClimbLevel, setAutoClimbLevel] = useState<string | null>("None");
  const [autoClimbOrientation, setAutoClimbOrientation] = useState<string[]>([]);

  // Teleop Climb state
  const [teleopClimbLevel, setTeleopClimbLevel] = useState<string[]>([]);
  const [teleopClimbOrientation, setTeleopClimbOrientation] = useState<string[]>([]);

    /* GENERATED:END */

  // Autos state (lifted from AutosSection)
  const [autoEntries, setAutoEntries] = useState<AutoEntry[]>([]);

  // Restore form data from context if available (for back navigation)
  useEffect(() => {
    if (formData && formData.teamNum === teamNum) {
      /* GENERATED:RESTORE:START */
      setMovementBump(formData.movement.bump);
      setMovementTrough(formData.movement.trough);
      setIntakeGround(formData.intake.ground);
      setIntakeOutpost(formData.intake.outpost);
      setFuelPassing(formData.fuel.passing);
      setFuelCapacity(formData.fuel.capacity || "");
      setAutoClimbLevel(formData.autoClimb.level);
      setAutoClimbOrientation(formData.autoClimb.orientation ?? []);
      setTeleopClimbLevel(formData.teleopClimb.level ?? []);
      setTeleopClimbOrientation(formData.teleopClimb.orientation ?? []);
    /* GENERATED:END */
      setAutoEntries(formData.autos);
    }
  }, [formData, teamNum]);

  const handleSave = () => {
    if (!teamNum || !teamName) {
      toast.error("Missing team information");
      return;
    }

    // Collect all form data
    const formData = {
      teamNum,
      teamName,
      /* GENERATED:SAVE:START */
      movement: {
        bump: movementBump,
        trough: movementTrough,
      },
      intake: {
        ground: intakeGround,
        outpost: intakeOutpost,
      },
      fuel: {
        passing: fuelPassing,
        capacity: fuelCapacity,
      },
      autoClimb: {
        level: autoClimbLevel,
        orientation: autoClimbOrientation,
      },
      teleopClimb: {
        level: teleopClimbLevel,
        orientation: teleopClimbOrientation,
      },
    /* GENERATED:END */
      autos: autoEntries,
    };

    // Save to context
    setFormData(formData);

    // Navigate to images page
    navigate({ to: "/pitscout-images", search: { teamNum, teamName } });
  };

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background px-6 pb-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
      {/* Header with Back Button, Team Info, and Cheat Sheet */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate({ to: "/pit" })}
            className="text-primary"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M15 18L9 12L15 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {teamNum && (
            <p className="text-base">
              <span className="font-bold text-primary">{teamNum}</span>
              {teamName && <span className="text-foreground"> | {teamName}</span>}
            </p>
          )}
        </div>
        {/* Cheat sheet info button */}
        <button
          type="button"
          onClick={() => setCheatSheetOpen(true)}
          className="text-primary flex-shrink-0"
          aria-label="Open cheat sheet"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-7 text-primary"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <path d="M12 16V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="8" r="1" fill="currentColor" />
          </svg>
        </button>
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-border mb-6" />

      {/* Sections */}
      <div className="flex flex-col gap-6">
        {/* GENERATED:FORM:START */}

        {/* Movement Section */}
        <Section title="Movement">
          <div className="flex flex-col gap-3 px-2">
            <div className="grid grid-cols-2 gap-3">
              <ScoutToggle
                pressed={movementBump}
                onPressedChange={setMovementBump}
                className="w-full"
                info="Can the robot cross through the bump area?"
              >
                Bump
              </ScoutToggle>
              <ScoutToggle
                pressed={movementTrough}
                onPressedChange={setMovementTrough}
                className="w-full"
                info="Can the robot traverse through the trough?"
              >
                Trough
              </ScoutToggle>
            </div>
          </div>
        </Section>

        {/* Intake Section */}
        <Section title="Intake">
          <div className="flex flex-col gap-3 px-2">
            <div className="grid grid-cols-2 gap-3">
              <ScoutToggle
                pressed={intakeGround}
                onPressedChange={setIntakeGround}
                className="w-full"
                info="Can the robot intake game pieces from the ground?"
              >
                Ground
              </ScoutToggle>
              <ScoutToggle
                pressed={intakeOutpost}
                onPressedChange={setIntakeOutpost}
                className="w-full"
                info="Can the robot intake from the outpost?"
              >
                Outpost
              </ScoutToggle>
            </div>
          </div>
        </Section>

        {/* Fuel Section */}
        <Section title="Fuel">
          <div className="flex flex-col gap-3 px-2">
            <div className="grid grid-cols-2 gap-3">
              <ScoutToggle
                pressed={fuelPassing}
                onPressedChange={setFuelPassing}
                className="w-full"
                info="Can the robot pass game pieces to alliance partners?"
              >
                Passing
              </ScoutToggle>
              <Input
                value={fuelCapacity}
                onChange={(e) => setFuelCapacity(e.target.value)}
                className="h-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
                placeholder="Ball Capacity"
              />
            </div>
          </div>
        </Section>

        {/* Auto Climb Section */}
        <Section title="Auto Climb">
          <div className="flex flex-col gap-3 px-2">
            <div className="grid grid-cols-2 gap-3">
              <ScoutToggle
                pressed={autoClimbLevel === "Climb"}
                onPressedChange={(p) => setAutoClimbLevel(p ? "Climb" : null)}
                className="w-full"
              >
                Climb
              </ScoutToggle>
              <ScoutToggle
                pressed={autoClimbLevel === "None"}
                onPressedChange={(p) => setAutoClimbLevel(p ? "None" : null)}
                className="w-full"
              >
                None
              </ScoutToggle>
            </div>
            {autoClimbLevel === "Climb" && (
              <div className="grid-cols-3 grid gap-3">
                <ScoutToggle
                  pressed={autoClimbOrientation.includes("Left")}
                  onPressedChange={() => setAutoClimbOrientation((prev) => prev.includes("Left") ? prev.filter((x) => x !== "Left") : [...prev, "Left"])}
                  className="w-full"
                  info="Climbs on the left of the tower"
                >
                  Left
                </ScoutToggle>
                <ScoutToggle
                  pressed={autoClimbOrientation.includes("Center")}
                  onPressedChange={() => setAutoClimbOrientation((prev) => prev.includes("Center") ? prev.filter((x) => x !== "Center") : [...prev, "Center"])}
                  className="w-full"
                  info="Climbs on the center of the tower"
                >
                  Center
                </ScoutToggle>
                <ScoutToggle
                  pressed={autoClimbOrientation.includes("Right")}
                  onPressedChange={() => setAutoClimbOrientation((prev) => prev.includes("Right") ? prev.filter((x) => x !== "Right") : [...prev, "Right"])}
                  className="w-full"
                  info="Climbs on the right of the tower"
                >
                  Right
                </ScoutToggle>
              </div>
            )}
          </div>
        </Section>

        {/* Teleop Climb Section */}
        <Section title="Teleop Climb">
          <div className="flex flex-col gap-3 px-2">
            <div className="grid grid-cols-4 gap-3">
              <ScoutToggle
                pressed={teleopClimbLevel.includes("L1")}
                onPressedChange={() => setTeleopClimbLevel((prev) => prev.includes("L1") ? prev.filter((x) => x !== "L1") : [...prev, "L1"])}
                className="w-full"
              >
                L1
              </ScoutToggle>
              <ScoutToggle
                pressed={teleopClimbLevel.includes("L2")}
                onPressedChange={() => setTeleopClimbLevel((prev) => prev.includes("L2") ? prev.filter((x) => x !== "L2") : [...prev, "L2"])}
                className="w-full"
              >
                L2
              </ScoutToggle>
              <ScoutToggle
                pressed={teleopClimbLevel.includes("L3")}
                onPressedChange={() => setTeleopClimbLevel((prev) => prev.includes("L3") ? prev.filter((x) => x !== "L3") : [...prev, "L3"])}
                className="w-full"
              >
                L3
              </ScoutToggle>
              <ScoutToggle
                pressed={teleopClimbLevel.length === 0}
                onPressedChange={() => setTeleopClimbLevel([])}
                className="w-full"
              >
                None
              </ScoutToggle>
            </div>
            {teleopClimbLevel.length > 0 && (
              <div className="grid-cols-3 grid gap-3">
                <ScoutToggle
                  pressed={teleopClimbOrientation.includes("Left")}
                  onPressedChange={() => setTeleopClimbOrientation((prev) => prev.includes("Left") ? prev.filter((x) => x !== "Left") : [...prev, "Left"])}
                  className="w-full"
                  info="Climbs on the left of the tower"
                >
                  Left
                </ScoutToggle>
                <ScoutToggle
                  pressed={teleopClimbOrientation.includes("Center")}
                  onPressedChange={() => setTeleopClimbOrientation((prev) => prev.includes("Center") ? prev.filter((x) => x !== "Center") : [...prev, "Center"])}
                  className="w-full"
                  info="Climbs on the center of the tower"
                >
                  Center
                </ScoutToggle>
                <ScoutToggle
                  pressed={teleopClimbOrientation.includes("Right")}
                  onPressedChange={() => setTeleopClimbOrientation((prev) => prev.includes("Right") ? prev.filter((x) => x !== "Right") : [...prev, "Right"])}
                  className="w-full"
                  info="Climbs on the right of the tower"
                >
                  Right
                </ScoutToggle>
              </div>
            )}
          </div>
        </Section>
        {/* GENERATED:END */}

        {/* Autos Section */}
        <AutosSection entries={autoEntries} setEntries={setAutoEntries} />
      </div>

      {/* Save Button - Fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 p-4 rounded-lg">
        <Button
          onClick={handleSave}
          className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          Next
        </Button>
      </div>

      {/* Bottom padding to prevent content from being hidden behind fixed button */}
      <div className="h-20" />

      {/* Cheat Sheet Popup */}
      <Dialog open={cheatSheetOpen} onOpenChange={setCheatSheetOpen}>
        <DialogContent className="w-[90vw] h-[80vh] max-w-none p-0 overflow-hidden">
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            <button
              type="button"
              onClick={() => setCheatSheetOpen(false)}
              className="absolute top-3 right-3 z-10 flex items-center justify-center size-8 rounded-full bg-black/60 text-white"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <img
              src="/cheatsheet.png"
              alt="Game Cheat Sheet"
              className="w-full h-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
