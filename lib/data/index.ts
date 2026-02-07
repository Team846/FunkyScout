// Data layer for Supabase operations
// Schema reference: ./schema.ts

export { bootstrapEvent, getEvents } from "./events";
export { getTeams } from "./teams";
export { refreshSchedule, getSchedule } from "./schedule";

// Re-export types for convenience
export type {
  EventList,
  EventTeamData,
  EventSchedule,
  Alliance,
} from "./schema";
