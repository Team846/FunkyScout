/**
 * Standalone Statbotics EPA test script
 * Tests two methods of fetching EPA for event teams and compares coverage.
 *
 * Method 1 (current app approach):
 *   - Fetch all team_years for the year from Statbotics
 *   - Filter down to teams at this event (team list from TBA)
 *
 * Method 2 (event-specific):
 *   - Fetch /team_events?event={event} directly from Statbotics
 *   - Returns event-level EPA (pre/during/post event snapshots)
 *
 * Run: bun run scripts/test-statbotics-epa.ts
 * Requires: VITE_X_TBA_AUTH_KEY in .env (or set TBA_KEY env var)
 */

import * as fs from "fs";
import * as path from "path";

// Load .env manually (no dotenv dependency needed)
function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) env[key.trim()] = rest.join("=").trim();
  }
  return env;
}

const env = loadEnv();
const TBA_KEY = process.env.TBA_KEY ?? env["VITE_X_TBA_AUTH_KEY"] ?? "";
const STATBOTICS_BASE = "https://api.statbotics.io/v3";
const TBA_BASE = "https://www.thebluealliance.com/api/v3";

const EVENTS = ["2026week0", "2025casf"];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function tbaGet(path: string) {
  const res = await fetch(`${TBA_BASE}${path}`, {
    headers: { "X-TBA-Auth-Key": TBA_KEY },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TBA ${path} → ${res.status}`);
  return res.json();
}

async function statGet(path: string) {
  const res = await fetch(`${STATBOTICS_BASE}${path}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Statbotics ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

function extractYear(eventKey: string): string {
  return eventKey.match(/^(\d{4})/)?.[1] ?? "";
}

function epaLabel(epa: any): string {
  if (!epa) return "null";
  const mean = epa?.total_points?.mean ?? epa?.epa?.total_points?.mean ?? null;
  return mean != null ? mean.toFixed(1) : "null";
}

// ── Method 1: year-level batch → filter ──────────────────────────────────────

async function method1(eventKey: string, tbaTeamNums: number[]) {
  const year = extractYear(eventKey);
  console.log(`\n  [Method 1] Fetching /team_years?year=${year} (all FRC teams)...`);

  let all: any[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const page: any[] = await statGet(`/team_years?year=${year}&limit=${limit}&offset=${offset}`) ?? [];
    all.push(...page);
    console.log(`    page offset=${offset}: ${page.length} teams (running total: ${all.length})`);
    if (page.length < limit) break;
    offset += limit;
  }

  const eventTeamSet = new Set(tbaTeamNums);
  const matched = all.filter((t: any) => eventTeamSet.has(t.team));

  return matched;
}

// ── Method 2: event-specific endpoint ────────────────────────────────────────

async function method2(eventKey: string) {
  console.log(`\n  [Method 2] Fetching /team_events?event=${eventKey}...`);
  const data: any[] | null = await statGet(`/team_events?event=${eventKey}&limit=100`);
  if (!data) {
    console.log("    → 404: event not indexed in Statbotics");
    return [];
  }
  console.log(`    → ${data.length} team_events returned`);
  return data;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function testEvent(eventKey: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`EVENT: ${eventKey}`);
  console.log("=".repeat(60));

  // Get team list from TBA
  console.log(`\n  [TBA] Fetching event teams for ${eventKey}...`);
  const tbaTeams: any[] | null = await tbaGet(`/event/${eventKey}/teams/simple`);
  if (!tbaTeams || tbaTeams.length === 0) {
    console.log("  → TBA: no teams found (event may not exist in TBA yet)");
    return;
  }
  const tbaTeamNums = tbaTeams.map((t: any) => parseInt(t.team_number));
  console.log(`  → TBA: ${tbaTeams.length} teams`);

  // Method 1
  let m1Results: any[] = [];
  try {
    m1Results = await method1(eventKey, tbaTeamNums);
  } catch (e: any) {
    console.log(`  [Method 1] ERROR: ${e.message}`);
  }

  // Method 2
  let m2Results: any[] = [];
  try {
    m2Results = await method2(eventKey);
  } catch (e: any) {
    console.log(`  [Method 2] ERROR: ${e.message}`);
  }

  // Build lookup maps
  const m1Map = new Map<number, any>(m1Results.map((t: any) => [t.team, t]));
  const m2Map = new Map<number, any>(m2Results.map((t: any) => [t.team, t]));

  // Print comparison table
  console.log(`\n  ${"─".repeat(56)}`);
  console.log(`  ${"Team".padEnd(8)} ${"Method1 EPA".padEnd(14)} ${"Method2 EPA".padEnd(14)} Match?`);
  console.log(`  ${"─".repeat(56)}`);

  let m1Count = 0, m2Count = 0, bothCount = 0;
  const sortedNums = [...tbaTeamNums].sort((a, b) => a - b);

  for (const num of sortedNums) {
    const m1 = m1Map.get(num);
    const m2 = m2Map.get(num);
    const m1Epa = m1?.epa?.total_points?.mean ?? null;
    const m2Epa = m2?.epa?.total_points?.mean ?? m2?.epa?.mean ?? null;
    const m1Label = m1Epa != null ? m1Epa.toFixed(1) : "—";
    const m2Label = m2Epa != null ? m2Epa.toFixed(1) : "—";
    const bothHave = m1Epa != null && m2Epa != null;
    const match = bothHave ? (Math.abs(m1Epa - m2Epa) < 0.01 ? "✓" : `≠ (Δ${(m1Epa - m2Epa).toFixed(1)})`) : "";
    if (m1Epa != null) m1Count++;
    if (m2Epa != null) m2Count++;
    if (bothHave) bothCount++;
    // Only print rows where at least one method has data (suppress full nulls to keep output manageable)
    if (m1Epa != null || m2Epa != null) {
      console.log(`  frc${String(num).padEnd(5)} ${m1Label.padEnd(14)} ${m2Label.padEnd(14)} ${match}`);
    }
  }

  console.log(`  ${"─".repeat(56)}`);
  console.log(`\n  Summary for ${eventKey}:`);
  console.log(`    TBA team count   : ${tbaTeams.length}`);
  console.log(`    Method 1 coverage: ${m1Count}/${tbaTeams.length} teams have EPA`);
  console.log(`    Method 2 coverage: ${m2Count}/${tbaTeams.length} teams have EPA`);
  if (m1Count > 0 && m2Count > 0) {
    console.log(`    Both have data   : ${bothCount} teams`);
  }

  // Teams missing from Method 1 but present in Method 2 (or vice versa)
  const onlyM1 = sortedNums.filter(n => m1Map.has(n) && !m2Map.has(n) && (m1Map.get(n)?.epa?.total_points?.mean != null));
  const onlyM2 = sortedNums.filter(n => !m1Map.has(n) && m2Map.has(n));
  if (onlyM1.length) console.log(`    Only in Method 1 : ${onlyM1.map(n => `frc${n}`).join(", ")}`);
  if (onlyM2.length) console.log(`    Only in Method 2 : ${onlyM2.map(n => `frc${n}`).join(", ")}`);
}

async function main() {
  if (!TBA_KEY) {
    console.error("ERROR: No TBA key found. Set VITE_X_TBA_AUTH_KEY in .env or TBA_KEY env var.");
    process.exit(1);
  }

  console.log("Statbotics EPA Comparison Test");
  console.log(`Events: ${EVENTS.join(", ")}`);
  console.log("Method 1: /team_years?year=YYYY → filter to event teams");
  console.log("Method 2: /team_events?event=EVENT_KEY");

  for (const event of EVENTS) {
    await testEvent(event);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("Done.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
