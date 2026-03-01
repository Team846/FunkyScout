import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shadcn/ui/components/card.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shadcn/ui/components/select.tsx";
import { Star, Loader2 } from "lucide-react";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import { useUserProfiles } from "../contexts/UserProfilesContext";
import {
  getScouterRatings,
  setScouterRating,
  type ScouterRating,
} from "@lib/data/scouterRatings";
import type { EventMatchData } from "@lib/db";
import { toast } from "sonner";

export const Route = createFileRoute("/scouter-ratings")({
  component: ScouterRatingsPage,
});

function ScouterRatingsPage() {
  const { currentEvent } = useDesktopEvent();
  const { schedule, matchScoutingData } = useDesktopCompetitionData();
  const { userProfiles } = useUserProfiles();
  const [scouterRatings, setScouterRatings] = useState<ScouterRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const hasLoadedRef = useRef(false);

  /**
   * Compute scouter ratings from context data (no async fetches needed).
   * Re-runs whenever matchScoutingData, userProfiles, or schedule updates.
   */
  const fetchData = useCallback(async () => {
    if (!currentEvent) return;

    try {
      const fetchedMatchData: EventMatchData[] = matchScoutingData.map((m) => ({
        event: m.event,
        match: m.match,
        team: m.team,
        alliance: m.alliance as "red" | "blue",
        data_raw: m.data_raw || {},
        data: m.data || {},
        name: m.name ?? undefined,
        uid: m.uid ?? undefined,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : undefined,
        last_modified: m.last_modified,
        deleted_at: undefined,
      }));

      const scheduleEntries = schedule.map((s) => ({
        event: currentEvent,
        match: s.match,
        team: s.team,
        alliance: s.alliance as "red" | "blue",
        name: s.name ?? undefined,
        uid: s.uid ?? undefined,
        last_modified: Date.now(),
        deleted_at: undefined,
      }));

      const ratings = await getScouterRatings(
        currentEvent,
        userProfiles as any,
        fetchedMatchData,
        scheduleEntries
      );
      setScouterRatings(ratings);
    } catch (error) {
      console.error("[ScouterRatings] Error computing ratings:", error);
      toast.error("Failed to fetch scouter ratings");
    } finally {
      setLoading(false);
    }
  }, [currentEvent, schedule, userProfiles, matchScoutingData]);

  // Re-compute whenever context data changes.
  // Only shows spinner on first load — background refreshes update silently.
  useEffect(() => {
    if (!currentEvent) return;
    if (!hasLoadedRef.current) setLoading(true);
    fetchData().finally(() => { hasLoadedRef.current = true; });
  }, [currentEvent, fetchData]);

  // Reset load flag when event changes so switching events shows the spinner
  useEffect(() => {
    hasLoadedRef.current = false;
  }, [currentEvent]);

  /**
   * Handle rating change for a scouter
   * Writes instantly to Supabase unless offline
   */
  const handleRatingChange = async (uid: string, newRating: number | null) => {
    // Add to saving set
    setSaving((prev) => new Set(prev).add(uid));

    try {
      console.log(`[ScouterRatings] Setting rating for ${uid}: ${newRating}`);

      // Write to Supabase (instant, unless offline)
      await setScouterRating(uid, newRating);

      // Update local state optimistically
      setScouterRatings((prev) =>
        prev.map((sr) =>
          sr.uid === uid ? { ...sr, rating: newRating } : sr
        )
      );

      toast.success("Rating updated successfully");
    } catch (error) {
      console.error("[ScouterRatings] Error setting rating:", error);
      toast.error("Failed to update rating");
    } finally {
      // Remove from saving set
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  };

  const renderStars = (rating: number | null) => {
    const filledStars = rating || 0;
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= filledStars
                ? "fill-yellow-400 text-yellow-400"
                : "text-gray-300"
            }`}
          />
        ))}
      </div>
    );
  };

  if (!currentEvent) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Scouter Ratings</CardTitle>
            <CardDescription>
              Please select an event to view scouter ratings
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Scouter Ratings Management</CardTitle>
          <CardDescription>
            Assign ratings (1-5 stars) to scouters based on accuracy and consistency.
            Updates every 30 seconds and shows real-time changes from other admins.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <div className="text-sm text-muted-foreground">Total Scouters</div>
                  <div className="text-2xl font-bold">{scouterRatings.length}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Rated Scouters</div>
                  <div className="text-2xl font-bold">
                    {scouterRatings.filter((s) => s.rating !== null).length}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Active Scouters</div>
                  <div className="text-2xl font-bold">
                    {scouterRatings.filter((s) => s.matchesScouted > 0).length}
                  </div>
                </div>
              </div>

              {/* Scouter Table */}
              <div className="border rounded-lg overflow-auto max-h-[600px]">
                <table className="w-full">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-4 font-medium">Scouter Name</th>
                      <th className="text-left p-4 font-medium">Matches Assigned</th>
                      <th className="text-left p-4 font-medium">Matches Scouted</th>
                      <th className="text-left p-4 font-medium">Current Rating</th>
                      <th className="text-left p-4 font-medium">Set Rating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {scouterRatings
                      .sort((a, b) => b.matchesScouted - a.matchesScouted)
                      .map((scouter) => (
                        <tr key={scouter.uid} className="hover:bg-muted/50">
                          <td className="p-4">
                            <div className="font-medium">{scouter.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {scouter.uid.slice(0, 8)}...
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="text-lg font-semibold">
                              {scouter.matchesAssigned}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="text-lg font-semibold">
                              {scouter.matchesScouted}
                            </div>
                          </td>
                          <td className="p-4">{renderStars(scouter.rating)}</td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Select
                                value={scouter.rating?.toString() || "none"}
                                onValueChange={(value) => {
                                  const rating = value === "none" ? null : parseInt(value);
                                  handleRatingChange(scouter.uid, rating);
                                }}
                                disabled={saving.has(scouter.uid)}
                              >
                                <SelectTrigger className="w-32">
                                  <SelectValue placeholder="No rating" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No rating</SelectItem>
                                  <SelectItem value="1">1 star</SelectItem>
                                  <SelectItem value="2">2 stars</SelectItem>
                                  <SelectItem value="3">3 stars</SelectItem>
                                  <SelectItem value="4">4 stars</SelectItem>
                                  <SelectItem value="5">5 stars</SelectItem>
                                </SelectContent>
                              </Select>
                              {saving.has(scouter.uid) && (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {scouterRatings.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No scouters found for this event
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
