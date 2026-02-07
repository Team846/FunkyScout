import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Toggle } from "@shadcn/ui/components/toggle.tsx";
import { Input } from "@shadcn/ui/components/input.tsx";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Slider } from "@shadcn/ui/components/slider.tsx";
import { Textarea } from "@shadcn/ui/components/textarea.tsx";
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
import { toast } from "sonner";
import { uploadPitImages } from "@lib/supabase/storage";
import { cacheEventTeamData } from "@lib/db";
import { useEvent } from "@lib/context/EventContext";

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
    setEntries([...entries, { id: newId, climb: false, drawing: null }]);
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
          <div key={entry.id} className="grid grid-cols-2 gap-3">
            <Input
              className="h-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
              placeholder="test"
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
  const { currentEvent } = useEvent();

  // Phase state
  const [step, setStep] = useState<1 | 2>(1);

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

  // Climb state
  const [climbLevel, setClimbLevel] = useState<string | null>(null);
  const [climbLeft, setClimbLeft] = useState(false);
  const [climbRight, setClimbRight] = useState(false);
  const [climbDeclimb, setClimbDeclimb] = useState(false);

  // Autos state (lifted from AutosSection)
  const [autoEntries, setAutoEntries] = useState<AutoEntry[]>([]);

  // Phase 2 state
  const [images, setImages] = useState<File[]>([]);
  const [rating, setRating] = useState<number>(3);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleNextPhase = () => {
    setStep(2);
  };

  const handleBackToPhase1 = () => {
    setStep(1);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setImages([...images, ...newFiles]);
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (images.length === 0 || !notes.trim()) {
      toast.error("Please provide at least 1 photo and notes");
      return;
    }

    if (!currentEvent || !teamNum) {
      toast.error("Missing event or team information");
      return;
    }

    setSubmitting(true);

    try {
      const { urls, errors } = await uploadPitImages({
        eventKey: currentEvent,
        teamKey: `frc${teamNum}`,
        files: images,
      });

      if (errors.length > 0) {
        console.warn("Some uploads failed:", errors);
        toast.warning(`${errors.length} image(s) failed to upload`);
      }

      const pitData = {
        movement: { depot: movementDepot, trough: movementTrough },
        intake: {
          ground: intakeGround,
          station: intakeStation,
          depot: intakeDepot,
          stocking: intakeStocking,
        },
        fuel: { shootMoving: fuelShootMoving, passing: fuelPassing },
        climb: {
          level: climbLevel,
          left: climbLeft,
          right: climbRight,
          declimb: climbDeclimb,
        },
        autos: autoEntries.map((e) => ({
          id: e.id,
          climb: e.climb,
          drawing: e.drawing,
        })),
        rating,
        notes,
        image_urls: urls,
      };

      await cacheEventTeamData([
        {
          event: currentEvent,
          team: `frc${teamNum}`,
          data: pitData,
          timestamp: Date.now(),
          last_modified: Date.now(),
        },
      ]);

      toast.success("Pit scouting completed!");
      navigate({ to: "/pit" });
    } catch (err) {
      console.error("Submit error:", err);
      toast.error("Failed to save pit data");
    } finally {
      setSubmitting(false);
    }
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

      {/* Phase Indicator */}
      <div className="flex items-center justify-center mb-4">
        <span className="text-sm text-muted-foreground">
          Phase {step}/2
        </span>
      </div>

      {/* Sections */}
      {step === 1 && (
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
                className="h-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
                placeholder="test"
              />
              <Input
                className="h-10 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
                placeholder="test"
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
            {(climbLevel === "L1" || climbLevel === "L2" || climbLevel === "L3") && (
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
      )}

      {/* Phase 2 UI */}
      {step === 2 && (
        <div className="flex flex-col gap-6">
          {/* Image Upload Section */}
          <Section title="Team Photos" defaultOpen={true}>
            <div className="flex flex-col gap-3 px-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full h-10"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-5 mr-2"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2" />
                </svg>
                Add Photos
              </Button>
              {images.length > 0 && (
                <>
                  <span className="text-sm text-muted-foreground">
                    {images.length} photo{images.length !== 1 ? "s" : ""} selected
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {images.map((file, index) => (
                      <div key={index} className="relative">
                        <img
                          src={URL.createObjectURL(file)}
                          alt={`Preview ${index + 1}`}
                          className="w-full h-24 object-cover rounded-lg border border-border"
                        />
                        <button
                          onClick={() => removeImage(index)}
                          className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="size-4"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M18 6L6 18M6 6l12 12"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Section>

          {/* Rating Section */}
          <Section title="Team Rating" defaultOpen={true}>
            <div className="flex flex-col gap-3 px-2">
              <div className="flex items-center justify-center">
                <span className="text-6xl font-bold text-primary">{rating}</span>
              </div>
              <Slider
                value={[rating]}
                onValueChange={(values) => setRating(values[0])}
                min={1}
                max={5}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>1</span>
                <span>2</span>
                <span>3</span>
                <span>4</span>
                <span>5</span>
              </div>
            </div>
          </Section>

          {/* Notes Section */}
          <Section title="Scouting Notes" defaultOpen={true}>
            <div className="px-2">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Enter your observations about this team..."
                rows={8}
                className="w-full resize-none"
              />
            </div>
          </Section>
        </div>
      )}

      {/* Action Buttons - Fixed at bottom */}
      <div className="fixed bottom-0 left-0 right-0 p-4 rounded-lg">
        {step === 1 ? (
          <Button
            onClick={handleNextPhase}
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Next Phase
          </Button>
        ) : (
          <div className="flex gap-3">
            <Button
              onClick={handleBackToPhase1}
              variant="outline"
              className="flex-1 h-12"
            >
              Back
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 h-12 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {submitting ? "Submitting..." : "Submit Pit Scout"}
            </Button>
          </div>
        )}
      </div>

      {/* Bottom padding to prevent content from being hidden behind fixed button */}
      <div className="h-20" />
    </div>
  );
}
