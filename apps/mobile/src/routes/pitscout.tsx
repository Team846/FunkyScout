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

// Info icon with popover
function InfoButton({ info }: { info?: string }) {
  if (!info) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-center"
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
        </button>
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
      { id: newId, climb: false, drawing: null, name: "", description: "" },
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
                info="My name is jeff"
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

  // Movement state
  const [movementDepot, setMovementDepot] = useState(false);
  const [movementTrough, setMovementTrough] = useState(false);

  // Intake state
  const [intakeGround, setIntakeGround] = useState(false);
  const [intakeStation, setIntakeStation] = useState(false);
  const [intakeDepot, setIntakeDepot] = useState(false);
  const [intakeStocking, setIntakeStocking] = useState(false);

  // Fuel state
  const [fuelShootMoving, setFuelShootMoving] = useState(false);
  const [fuelPassing, setFuelPassing] = useState(false);
  const [fuelBps, setFuelBps] = useState("");
  const [fuelCapacity, setFuelCapacity] = useState("");

  // Climb state
  const [climbLevel, setClimbLevel] = useState<string | null>(null);
  const [climbLeft, setClimbLeft] = useState(false);
  const [climbRight, setClimbRight] = useState(false);
  const [climbDeclimb, setClimbDeclimb] = useState(false);

  // Autos state (lifted from AutosSection)
  const [autoEntries, setAutoEntries] = useState<AutoEntry[]>([]);

  // Restore form data from context if available (for back navigation)
  useEffect(() => {
    if (formData && formData.teamNum === teamNum) {
      setMovementDepot(formData.movement.depot);
      setMovementTrough(formData.movement.trough);
      setIntakeGround(formData.intake.ground);
      setIntakeStation(formData.intake.station);
      setIntakeDepot(formData.intake.depot);
      setIntakeStocking(formData.intake.stocking);
      setFuelShootMoving(formData.fuel.shootMoving);
      setFuelPassing(formData.fuel.passing);
      setFuelBps(formData.fuel.bps || "");
      setFuelCapacity(formData.fuel.capacity || "");
      setClimbLevel(formData.climb.level);
      setClimbLeft(formData.climb.left);
      setClimbRight(formData.climb.right);
      setClimbDeclimb(formData.climb.declimb);
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
      movement: {
        depot: movementDepot,
        trough: movementTrough,
      },
      intake: {
        ground: intakeGround,
        station: intakeStation,
        depot: intakeDepot,
        stocking: intakeStocking,
      },
      fuel: {
        shootMoving: fuelShootMoving,
        passing: fuelPassing,
        bps: fuelBps,
        capacity: fuelCapacity,
      },
      climb: {
        level: climbLevel,
        left: climbLeft,
        right: climbRight,
        declimb: climbDeclimb,
      },
      autos: autoEntries,
    };

    // Save to context
    setFormData(formData);

    // Navigate to images page
    navigate({ to: "/pitscout-images", search: { teamNum, teamName } });
  };

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background px-6 py-4">
      {/* Header with Back Button and Team Info */}
      <div className="flex items-center gap-4 mb-4">
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

      {/* Divider */}
      <div className="h-px w-full bg-border mb-6" />

      {/* Sections */}
      <div className="flex flex-col gap-6">
        {/* Movement Section */}
        <Section title="Movement">
          <div className="grid grid-cols-2 gap-3 px-2">
            <ScoutToggle
              pressed={movementDepot}
              onPressedChange={setMovementDepot}
              className="w-full"
              info="Im the goat"
            >
              Depot
            </ScoutToggle>
            <ScoutToggle
              pressed={movementTrough}
              onPressedChange={setMovementTrough}
              className="w-full"
            >
              Trough
            </ScoutToggle>
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
              >
                Ground
              </ScoutToggle>
              <ScoutToggle
                pressed={intakeStation}
                onPressedChange={setIntakeStation}
                className="w-full"
              >
                Station
              </ScoutToggle>
            </div>
            {intakeGround && (
              <ScoutToggle
                pressed={intakeDepot}
                onPressedChange={setIntakeDepot}
                className="w-full"
              >
                Depot
              </ScoutToggle>
            )}
            {intakeStation && (
              <ScoutToggle
                pressed={intakeStocking}
                onPressedChange={setIntakeStocking}
                className="w-full"
              >
                Stocking
              </ScoutToggle>
            )}
          </div>
        </Section>

        {/* Fuel Section */}
        <Section title="Fuel">
          <div className="flex flex-col gap-3 px-2">
            <div className="grid grid-cols-2 gap-3">
              <ScoutToggle
                pressed={fuelShootMoving}
                onPressedChange={setFuelShootMoving}
                className="w-full"
              >
                Shoot as moving
              </ScoutToggle>
              <ScoutToggle
                pressed={fuelPassing}
                onPressedChange={setFuelPassing}
                className="w-full"
              >
                Passing
              </ScoutToggle>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={fuelBps}
                onChange={(e) => setFuelBps(e.target.value)}
                className="h-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
                placeholder="Balls Per Sec"
              />
              <Input
                value={fuelCapacity}
                onChange={(e) => setFuelCapacity(e.target.value)}
                className="h-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
                placeholder="Ball Capacity"
              />
            </div>
          </div>
        </Section>

        {/* Climb Section */}
        <Section title="Climb">
          <div className="flex flex-col gap-3 px-2">
            <div className="grid grid-cols-4 gap-3">
              <ScoutToggle
                pressed={climbLevel === "L1"}
                onPressedChange={(p) => setClimbLevel(p ? "L1" : null)}
                className="w-full"
              >
                L1
              </ScoutToggle>
              <ScoutToggle
                pressed={climbLevel === "L2"}
                onPressedChange={(p) => setClimbLevel(p ? "L2" : null)}
                className="w-full"
              >
                L2
              </ScoutToggle>
              <ScoutToggle
                pressed={climbLevel === "L3"}
                onPressedChange={(p) => setClimbLevel(p ? "L3" : null)}
                className="w-full"
              >
                L3
              </ScoutToggle>
              <ScoutToggle
                pressed={climbLevel === "None"}
                onPressedChange={(p) => setClimbLevel(p ? "None" : null)}
                className="w-full"
              >
                N/A
              </ScoutToggle>
            </div>
            {(climbLevel === "L1" ||
              climbLevel === "L2" ||
              climbLevel === "L3") && (
              <div className="grid grid-cols-3 gap-3">
                <ScoutToggle
                  pressed={climbLeft}
                  onPressedChange={setClimbLeft}
                  className="w-full"
                >
                  Left
                </ScoutToggle>
                <ScoutToggle
                  pressed={climbRight}
                  onPressedChange={setClimbRight}
                  className="w-full"
                >
                  Right
                </ScoutToggle>
                <ScoutToggle
                  pressed={climbDeclimb}
                  onPressedChange={setClimbDeclimb}
                  className="w-full"
                >
                  Declimb
                </ScoutToggle>
              </div>
            )}
          </div>
        </Section>

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
    </div>
  );
}
