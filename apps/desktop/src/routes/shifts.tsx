import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shadcn/ui/components/card.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shadcn/ui/components/tabs.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shadcn/ui/components/table.tsx";
import { Badge } from "@shadcn/ui/components/badge.tsx";
import { useDesktopEvent } from "../contexts/DesktopEventContext";
import { useDesktopCompetitionData } from "../contexts/DesktopCompetitionDataContext";
import {
  getShiftsByMatch,
  getShiftsByScouter,
  type MatchAssignment,
  type ScouterSchedule,
} from "@lib/data/shiftViews";

export const Route = createFileRoute("/shifts")({
  component: ShiftViewerPage,
});

function ShiftViewerPage() {
  const { currentEvent } = useDesktopEvent();
  const { lastDataRefreshAt } = useDesktopCompetitionData();
  const [byMatch, setByMatch] = useState<Map<string, MatchAssignment[]>>(new Map());
  const [byScouter, setByScouter] = useState<ScouterSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadShifts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEvent, lastDataRefreshAt]);

  const loadShifts = async () => {
    if (!currentEvent) return;

    setLoading(true);
    try {
      console.log("[Shifts] Loading shifts for event:", currentEvent);
      const [matchData, scouterData] = await Promise.all([
        getShiftsByMatch(currentEvent),
        getShiftsByScouter(currentEvent),
      ]);

      console.log("[Shifts] Loaded:", {
        matches: matchData.size,
        scouters: scouterData.length,
      });

      setByMatch(matchData);
      setByScouter(scouterData);
    } catch (error) {
      console.error("[Shifts] Failed to load shifts:", error);
      if (error instanceof Error) {
        console.error("[Shifts] Error details:", error.message, error.stack);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!currentEvent) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Shift Viewer</CardTitle>
            <CardDescription>Please select an event to view shifts</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Convert map to sorted array for display
  const matchArray = Array.from(byMatch.entries())
    .map(([match, assignments]) => ({
      match,
      assignments,
    }))
    .sort((a, b) => {
      // Sort by match number
      const aNum = parseInt(a.match.replace(/\D/g, "")) || 0;
      const bNum = parseInt(b.match.replace(/\D/g, "")) || 0;
      return aNum - bNum;
    });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Shift Viewer - {currentEvent}</CardTitle>
          <CardDescription>
            View scouting assignments by match or by scouter
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="by-match" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="by-match">By Match</TabsTrigger>
              <TabsTrigger value="by-scouter">By Scouter</TabsTrigger>
            </TabsList>

            {/* By Match View */}
            <TabsContent value="by-match" className="space-y-4">
              {loading ? (
                <div className="text-center py-12 text-muted-foreground">
                  Loading shifts...
                </div>
              ) : matchArray.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No shifts found for this event
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Match</TableHead>
                        <TableHead>Red 1</TableHead>
                        <TableHead>Red 2</TableHead>
                        <TableHead>Red 3</TableHead>
                        <TableHead>Blue 1</TableHead>
                        <TableHead>Blue 2</TableHead>
                        <TableHead>Blue 3</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {matchArray.map(({ match, assignments }) => {
                        // Sort by alliance and team
                        const sorted = assignments.sort((a, b) => {
                          if (a.alliance !== b.alliance) {
                            return a.alliance === "red" ? -1 : 1;
                          }
                          return a.team.localeCompare(b.team);
                        });

                        const red = sorted.filter((a) => a.alliance === "red");
                        const blue = sorted.filter((a) => a.alliance === "blue");

                        return (
                          <TableRow key={match}>
                            <TableCell className="font-medium">{match}</TableCell>
                            {[0, 1, 2].map((i) => (
                              <TableCell key={`red-${i}`}>
                                {red[i] ? (
                                  <div className="space-y-1">
                                    <div className="font-mono text-xs">
                                      {red[i].team.replace("frc", "")}
                                    </div>
                                    {red[i].scouterName ? (
                                      <Badge variant="secondary" className="text-xs">
                                        {red[i].scouterName}
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs">
                                        Unassigned
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            ))}
                            {[0, 1, 2].map((i) => (
                              <TableCell key={`blue-${i}`}>
                                {blue[i] ? (
                                  <div className="space-y-1">
                                    <div className="font-mono text-xs">
                                      {blue[i].team.replace("frc", "")}
                                    </div>
                                    {blue[i].scouterName ? (
                                      <Badge variant="secondary" className="text-xs">
                                        {blue[i].scouterName}
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs">
                                        Unassigned
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            {/* By Scouter View */}
            <TabsContent value="by-scouter" className="space-y-4">
              {loading ? (
                <div className="text-center py-12 text-muted-foreground">
                  Loading shifts...
                </div>
              ) : byScouter.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No scouters assigned for this event
                </div>
              ) : (
                <div className="space-y-6">
                  {byScouter.map((scouter) => (
                    <Card key={scouter.uid}>
                      <CardHeader>
                        <CardTitle className="text-lg">
                          {scouter.name}
                          <span className="ml-2 text-sm font-normal text-muted-foreground">
                            ({scouter.totalMatches} matches)
                          </span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Match</TableHead>
                                <TableHead>Team</TableHead>
                                <TableHead>Alliance</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {scouter.assignments.map((assignment) => (
                                <TableRow key={`${assignment.match}-${assignment.team}`}>
                                  <TableCell className="font-medium">
                                    {assignment.match}
                                  </TableCell>
                                  <TableCell className="font-mono">
                                    {assignment.team.replace("frc", "")}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        assignment.alliance === "red"
                                          ? "destructive"
                                          : "default"
                                      }
                                      className="capitalize"
                                    >
                                      {assignment.alliance || "Unknown"}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
