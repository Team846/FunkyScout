// Base fetch
export { fetchStatboticsData } from "./fetch";

// Team-level functions
export { fetchStatboticsTeamData, fetchStatboticsTeamEPA } from "./team";
export type { StatboticsTeamData, StatboticsTeamEPAs } from "./team";

// Event-level functions
export { fetchEventMatches, fetchEventTeamYears } from "./event";

// Match-level functions
export { fetchStatboticsMatch } from "./match";
export type { StatboticsMatch } from "./match";
