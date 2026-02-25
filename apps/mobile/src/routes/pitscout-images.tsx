import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Button } from "@shadcn/ui/components/button.tsx";
import { Textarea } from "@shadcn/ui/components/textarea.tsx";
import { Slider } from "@shadcn/ui/components/slider.tsx";
import { Badge } from "@shadcn/ui/components/badge.tsx";
import { Alert, AlertDescription } from "@shadcn/ui/components/alert.tsx";
import { usePitScoutForm } from "@lib/context/PitScoutFormContext";
import { useEvent } from "@lib/context/EventContext";
import { useSync } from "@lib/context/SyncContext";
import { putTeamDataWithImages } from "@lib/data/writes";
import { getSession } from "@lib/supabase/auth";
import { getLocalUserData } from "@lib/supabase/user";
import { toast } from "sonner";

type ImagesSearch = {
  teamNum?: number;
  teamName?: string;
};

export const Route = createFileRoute("/pitscout-images")({
  component: PitScoutImagesPage,
  validateSearch: (search: Record<string, unknown>): ImagesSearch => ({
    teamNum: search.teamNum as number | undefined,
    teamName: search.teamName as string | undefined,
  }),
});

function PitScoutImagesPage() {
  const { teamNum, teamName } = Route.useSearch();
  const navigate = useNavigate();
  const { formData, clearFormData } = usePitScoutForm();
  const { currentEvent } = useEvent();
  const { isSyncing } = useSync();

  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [rating, setRating] = useState(3);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "submitting" | "synced"
  >("idle");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validation: require at least 1 image and description
  const canSubmit =
    selectedImages.length > 0 && description.trim().length > 0 && !submitting;

  // Handle image selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Add to selected images
    setSelectedImages((prev) => [...prev, ...files]);

    // Create previews
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreviews((prev) => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  // Remove image
  const handleRemoveImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit
  const handleSubmit = async () => {
    if (!canSubmit || !formData || !currentEvent || !teamNum) {
      toast.error("Missing required data");
      return;
    }

    setSubmitting(true);
    setSyncStatus("submitting");

    try {
      // Get user session and local user data
      const session = await getSession();
      const localUser = getLocalUserData();
      const userName = localUser.name || session?.user?.email || "Unknown";
      const userId = session?.user?.id || "unknown";

      // Prepare full data with images metadata
      // Normalize autos: pit scouting uses "climb", team-info expects "climbDuringAuto"
      const normalizedAutos = (formData.autos || []).map((auto) => ({
        ...auto,
        climbDuringAuto: auto.climb ?? false,
      }));
      const fullData = {
        ...formData,
        autos: normalizedAutos,
        images: {
          rating,
          description,
          files: [], // Will be populated by sync after upload
        },
      };

      // Submit with offline-first pattern
      await putTeamDataWithImages(
        currentEvent,
        `frc${teamNum}`,
        fullData,
        selectedImages,
        {
          teamName,
          name: userName,
          uid: userId,
        }
      );

      toast.success("Pit scouting submitted!");
      setSyncStatus("synced");

      // Clear form data
      clearFormData();

      // Navigate to home after short delay
      setTimeout(() => {
        navigate({ to: "/home" });
      }, 1500);
    } catch (error) {
      console.error("Submit error:", error);
      toast.error("Failed to submit pit data");
      setSyncStatus("idle");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    navigate({ to: "/pitscout", search: { teamNum, teamName } });
  };

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background px-6 py-4">
      {/* Header with Back Button + Team Info (same style as first page) */}
      <div className="flex items-center gap-4 mb-4">
        <button onClick={handleBack} className="text-primary">
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

      {/* Content (scrollable like first page) */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 pb-24">
          {/* Images Section */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-md text-primary font-light">Images</span>
              <span className="text-destructive text-sm">*</span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />

            <div className="px-2">
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full h-10 rounded-lg border border-border bg-background text-foreground font-light hover:bg-background"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-4 mr-2"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 5V19M5 12H19"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                Add Images
              </Button>

              {/* Image Previews */}
              {imagePreviews.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {imagePreviews.map((preview, idx) => (
                    <div key={idx} className="relative aspect-square">
                      <img
                        src={preview}
                        alt={`Preview ${idx + 1}`}
                        className="h-full w-full rounded-lg object-cover border border-border"
                      />
                      <button
                        onClick={() => handleRemoveImage(idx)}
                        className="absolute top-1 right-1 rounded-full border border-border bg-background/80 p-1 text-muted-foreground hover:text-foreground"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="size-4"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M18 6L6 18M6 6L18 18"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3">
                <Badge variant="secondary" className="font-light">
                  {selectedImages.length} image
                  {selectedImages.length !== 1 ? "s" : ""} selected
                </Badge>
              </div>
            </div>
          </div>

          {/* Rating Section */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-md text-primary font-light">Rating</span>
              <span className="text-muted-foreground text-sm font-light">
                {rating}/5
              </span>
            </div>

            <div className="px-2">
              <Slider
                value={[rating]}
                onValueChange={([value]) => setRating(value)}
                min={1}
                max={5}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between mt-2 text-xs text-muted-foreground font-light">
                <span>1</span>
                <span>2</span>
                <span>3</span>
                <span>4</span>
                <span>5</span>
              </div>
            </div>
          </div>

          {/* Description Section */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-md text-primary font-light">
                Description
              </span>
              <span className="text-destructive text-sm">*</span>
            </div>

            <div className="px-2">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the robot's capabilities, build quality, strategy..."
                className="min-h-32 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* Sync Status (same content, just styled to fit) */}
          {syncStatus !== "idle" && (
            <div className="px-2">
              <Alert className="bg-muted border border-border">
                <AlertDescription className="text-sm text-muted-foreground font-light">
                  {syncStatus === "submitting" && "Submitting locally..."}
                  {syncStatus === "synced" &&
                    isSyncing &&
                    "Syncing to cloud..."}
                  {syncStatus === "synced" && !isSyncing && "✓ Synced to cloud"}
                </AlertDescription>
              </Alert>
            </div>
          )}
        </div>
      </div>

      {/* Bottom button (always on top) */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-background p-4 rounded-lg">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {submitting ? "Submitting..." : "Submit Pit Scouting"}
        </Button>

        {!canSubmit && selectedImages.length === 0 && (
          <p className="mt-2 text-center text-sm font-light text-destructive">
            Please add at least one image
          </p>
        )}

        {!canSubmit &&
          description.trim().length === 0 &&
          selectedImages.length > 0 && (
            <p className="mt-2 text-center text-sm font-light text-destructive">
              Please add a description
            </p>
          )}
      </div>

      {/* Bottom padding to prevent content from being hidden behind fixed button */}
      <div className="h-20" />
    </div>
  );
}
