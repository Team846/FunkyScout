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
    selectedImages.length > 0 &&
    description.trim().length > 0 &&
    !submitting;

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
      // Get user session
      const session = await getSession();
      const userName = session?.user?.email || "Unknown";
      const userId = session?.user?.id || "unknown";

      // Prepare full data with images metadata
      const fullData = {
        ...formData,
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
        },
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
      {/* Back Button */}
      <button onClick={handleBack} className="text-primary mb-4">
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

      {/* Divider */}
      <div className="h-px w-full bg-border mb-6" />

      {/* Header */}
      <div className="mb-6">
        <p className="text-lg font-semibold text-foreground">
          Team {teamNum} - {teamName}
        </p>
        <p className="text-sm text-muted-foreground">
          Add images and description
        </p>
      </div>

      {/* Image Upload Section */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-foreground mb-2">
          Images <span className="text-destructive">*</span>
        </label>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleImageSelect}
          className="hidden"
        />

        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
          className="w-full mb-4"
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
          <div className="grid grid-cols-3 gap-2 mb-4">
            {imagePreviews.map((preview, idx) => (
              <div key={idx} className="relative aspect-square">
                <img
                  src={preview}
                  alt={`Preview ${idx + 1}`}
                  className="w-full h-full object-cover rounded-lg"
                />
                <button
                  onClick={() => handleRemoveImage(idx)}
                  className="absolute top-1 right-1 bg-destructive text-white rounded-full p-1"
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

        <Badge variant="secondary">
          {selectedImages.length} image{selectedImages.length !== 1 ? "s" : ""}{" "}
          selected
        </Badge>
      </div>

      {/* Rating Slider */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-foreground mb-2">
          Rating: {rating}/5
        </label>
        <Slider
          value={[rating]}
          onValueChange={([value]) => setRating(value)}
          min={1}
          max={5}
          step={1}
          className="w-full"
        />
        <div className="flex justify-between mt-1 text-xs text-muted-foreground">
          <span>1</span>
          <span>2</span>
          <span>3</span>
          <span>4</span>
          <span>5</span>
        </div>
      </div>

      {/* Description */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-foreground mb-2">
          Description <span className="text-destructive">*</span>
        </label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the robot's capabilities, build quality, strategy..."
          className="min-h-32"
        />
      </div>

      {/* Sync Status Alert */}
      {syncStatus !== "idle" && (
        <Alert className="mb-4">
          <AlertDescription>
            {syncStatus === "submitting" && "Submitting locally..."}
            {syncStatus === "synced" && isSyncing && "Syncing to cloud..."}
            {syncStatus === "synced" && !isSyncing && "✓ Synced to cloud"}
          </AlertDescription>
        </Alert>
      )}

      {/* Submit Button */}
      <div className="sticky bottom-0 left-0 right-0 bg-background border-t border-border px-6 py-4 -mx-6 -mb-4">
        <Button onClick={handleSubmit} disabled={!canSubmit} className="w-full">
          {submitting ? "Submitting..." : "Submit Pit Scouting"}
        </Button>
        {!canSubmit && selectedImages.length === 0 && (
          <p className="text-xs text-destructive mt-2 text-center">
            Please add at least one image
          </p>
        )}
        {!canSubmit &&
          description.trim().length === 0 &&
          selectedImages.length > 0 && (
            <p className="text-xs text-destructive mt-2 text-center">
              Please add a description
            </p>
          )}
      </div>
    </div>
  );
}
