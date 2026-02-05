import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Input } from "@shadcn/ui/components/input.tsx";
import { getEvents } from "@lib/data/events";
import { useEvent } from "@lib/context/EventContext";
import type { EventList } from "@lib/data/schema";

export const Route = createFileRoute("/events")({
  component: EventsPage,
});

function EventsPage() {
  const navigate = useNavigate();
  const { setCurrentEvent } = useEvent();
  const [events, setEvents] = useState<EventList[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getEvents()
      .then((data) => {
        const sorted = (data || []).sort((a, b) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setEvents(sorted);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSelectEvent = (eventKey: string) => {
    setCurrentEvent(eventKey);
    navigate({ to: "/home" });
  };

  const filteredEvents = events.filter((event) =>
    event.alias.toLowerCase().includes(search.toLowerCase()) ||
    event.event.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center">
      <div className="w-72 px-5 py-16 flex flex-col gap-4">
      {/* Search Bar */}
      <div className="relative mb-6">
        <Input
          placeholder="Search events..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-12 w-full rounded-2xl border-border bg-muted pl-4 pr-10 text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary"
        />
        <div className="absolute right-4 top-1/2 -translate-y-1/2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M21 21L15.0001 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z"
              stroke="#FBBF24"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Events List */}
      <div className="flex max-h-80 overflow-y-auto flex-col gap-3">
        {loading ? (
          <p className="text-center text-muted-foreground">Loading events...</p>
        ) : events.length === 0 ? (
          <p className="text-center text-muted-foreground">No events found</p>
        ) : (
          events.map((event) => {
            const date = new Date(event.date);
            const monthDay = `${date.getMonth() + 1}/${date.getDate()}`;
            const year = date.getFullYear();

            return (
              <div
                key={event.event}
                onClick={() => handleSelectEvent(event.event)}
                className="group relative flex w-full cursor-pointer items-center justify-between rounded-xl border border-border bg-muted px-5 py-4 transition-colors hover:bg-accent/50"
              >
                <div className="flex flex-col">
                  <span className="text-md font-medium text-primary ">
                    {event.event}
                  </span>
                  <span className="text-sm text-muted-foreground max-w-32 truncate">
                    {event.alias}
                  </span>
                </div>
                
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground font-mono">
                    {monthDay}
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    xmlns="http://www.w3.org/2000/svg"
                    className="text-primary"
                  >
                    <path
                      d="M8 4L16 12L8 20"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </div>
              </div>
            );
          })
        )}
        </div>
    </div>
    </div>
  );
}
