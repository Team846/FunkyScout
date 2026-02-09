/**
 * Local SQLite database for offline-first functionality.
 * Worker-backed sqlite-wasm so OPFS can work long-term.
 */

import { execWorker, initDbWorker } from "./workerClient";

let dbReady: Promise<void> | null = null;

let writeLock: Promise<void> = Promise.resolve();

async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release!: () => void;
  writeLock = new Promise<void>((r) => {
    release = r;
  });

  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function initDatabase(): Promise<void> {
  if (dbReady) return dbReady;
  dbReady = (async () => {
    console.log("[LocalDB] Initializing SQLite in Worker...");
    await initDbWorker();
    console.log("[LocalDB] Worker DB initialized");
  })();
  return dbReady;
}

// ============ INTERFACES ============

export interface EventTeamData {
  event: string;
  team: string;
  data: any; // JSON
  team_name?: string;
  name?: string;
  uid?: string;
  assigned?: string;
  timestamp?: number;
  last_modified?: number;
  deleted_at?: number;
}

export interface EventScheduleEntry {
  event: string;
  match: string;
  team: string;
  alliance: "red" | "blue";
  name?: string;
  uid?: string;
  last_modified?: number;
  deleted_at?: number;
}

export interface EventMatchData {
  event: string;
  match: string;
  team: string;
  alliance?: string;
  data_raw?: any; // JSON
  data?: any; // JSON
  name?: string;
  uid: string;
  timestamp: number;
  last_modified?: number;
  deleted_at?: number;
}

export interface EventPicklist {
  id: string;
  event: string;
  title?: string;
  picklist?: any; // JSON
  uname?: string;
  uid?: string;
  type?: string;
  timestamp?: number;
  last_modified?: number;
  deleted_at?: number;
}

export interface EventPicklistEntry {
  event: string;
  id: string;
  team: string;
  rank?: number;
  flags?: any; // JSON
  last_modified?: number;
  deleted_at?: number;
}

export interface LocalEvent {
  event: string;
  alias: string;
  date: string;
  deleted_at?: number;
}

export interface TbaTeam {
  event: string;
  team_key: string;
  team_number: number;
  name?: string;
  rank?: number;
  wins?: number;
  losses?: number;
  ties?: number;
  next_match?: string;
  last_match?: string;
  epa?: {
    total_points?: { mean?: number; sd?: number };
    auto?: { mean?: number; sd?: number };
    teleop?: { mean?: number; sd?: number };
    endgame?: { mean?: number; sd?: number };
    norm?: number;
  } | null;
  opr?: number;
  dpr?: number;
  last_synced?: number;
}

export interface TbaMatch {
  event: string;
  match_key: string;
  comp_level?: string;
  match_number?: number;
  est_time?: number;
  red_teams: string[]; // JSON array
  blue_teams: string[]; // JSON array
  red_score?: number;
  blue_score?: number;
  // Statbotics predictions (synced from desktop via Supabase)
  red_win_prob?: number;
  predicted_red_score?: number;
  predicted_blue_score?: number;
  last_synced?: number;
}

export interface StatboticsEpa {
  event: string;
  team: string;
  epa: any; // JSON
  last_synced?: number;
}

export interface StatboticsMatchPred {
  event: string;
  match: string;
  pred: any; // JSON
  last_synced?: number;
}

export interface SyncQueueItem {
  id: number;
  type: string;
  payload: any;
  created_at: number;
  retries: number;
  last_error?: string;
}

// ============ SUPABASE-MIRROR CRUD ============

export async function getLocalEventList(): Promise<LocalEvent[]> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT * FROM event_list WHERE deleted_at IS NULL ORDER BY date DESC",
  );
  return rows as LocalEvent[];
}

export async function cacheEventList(events: LocalEvent[]): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    await execWorker("BEGIN TRANSACTION");
    try {
      for (const event of events) {
        await execWorker(
          `INSERT INTO event_list (event, alias, date, deleted_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(event) DO UPDATE SET
           alias=excluded.alias, date=excluded.date, deleted_at=excluded.deleted_at`,
          [
            event.event,
            event.alias,
            event.date,
            event.deleted_at
              ? Date.parse(new Date(event.deleted_at).toISOString())
              : null,
          ],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

export async function getEventTeamData(
  event: string,
): Promise<EventTeamData[]> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT * FROM event_team_data WHERE event = ? AND deleted_at IS NULL",
    [event],
  );
  return (rows as any[]).map((row) => ({
    ...row,
    data: row.data ? JSON.parse(row.data) : null,
  }));
}

export async function cacheEventTeamData(data: EventTeamData[]): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    await execWorker("BEGIN TRANSACTION");
    try {
      // Clear old team data for this event before inserting fresh data
      if (data.length > 0) {
        const event = data[0].event;
        await execWorker("DELETE FROM event_team_data WHERE event = ?", [event]);
      }

      for (const item of data) {
        await execWorker(
          `INSERT INTO event_team_data
           (event, team, data, team_name, name, uid, assigned, timestamp, last_modified, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event, team) DO UPDATE SET
           data=excluded.data, team_name=excluded.team_name, name=excluded.name,
           uid=excluded.uid, assigned=excluded.assigned, timestamp=excluded.timestamp,
           last_modified=excluded.last_modified, deleted_at=excluded.deleted_at`,
          [
            item.event,
            item.team,
            JSON.stringify(item.data),
            item.team_name,
            item.name,
            item.uid,
            item.assigned,
            item.timestamp,
            item.last_modified,
            item.deleted_at,
          ],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

export async function getEventSchedule(
  event: string,
): Promise<EventScheduleEntry[]> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT * FROM event_schedule WHERE event = ? AND deleted_at IS NULL",
    [event],
  );
  return rows as EventScheduleEntry[];
}

export async function getUserEventScheduleAssignments(
  event: string,
  userName: string,
): Promise<EventScheduleEntry[]> {
  await initDatabase();
  const rows = await execWorker(
    `SELECT * FROM event_schedule
     WHERE event = ? AND name = ? AND deleted_at IS NULL`,
    [event, userName],
  );
  return rows as EventScheduleEntry[];
}

export async function cacheEventSchedule(
  entries: EventScheduleEntry[],
): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    await execWorker("BEGIN TRANSACTION");
    try {
      // Clear old schedule for this event before inserting fresh data
      if (entries.length > 0) {
        const event = entries[0].event;
        await execWorker("DELETE FROM event_schedule WHERE event = ?", [event]);
      }

      for (const entry of entries) {
        await execWorker(
          `INSERT INTO event_schedule
           (event, match, team, alliance, name, uid, last_modified, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event, match, team) DO UPDATE SET
           alliance=excluded.alliance, name=excluded.name, uid=excluded.uid,
           last_modified=excluded.last_modified, deleted_at=excluded.deleted_at`,
          [
            entry.event,
            entry.match,
            entry.team,
            entry.alliance,
            entry.name,
            entry.uid,
            entry.last_modified,
            entry.deleted_at,
          ],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

export async function getEventMatchData(
  event: string,
  match?: string,
  team?: string,
): Promise<EventMatchData[]> {
  await initDatabase();
  let sql =
    "SELECT * FROM event_match_data WHERE event = ? AND deleted_at IS NULL";
  const params: any[] = [event];
  if (match) {
    sql += " AND match = ?";
    params.push(match);
  }
  if (team) {
    sql += " AND team = ?";
    params.push(team);
  }
  const rows = await execWorker(sql, params);
  return (rows as any[]).map((row) => ({
    ...row,
    data_raw: row.data_raw ? JSON.parse(row.data_raw) : null,
    data: row.data ? JSON.parse(row.data) : null,
  }));
}

export async function cacheEventMatchData(
  data: EventMatchData[],
): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    await execWorker("BEGIN TRANSACTION");
    try {
      // Clear old match data for this event before inserting fresh data
      if (data.length > 0) {
        const event = data[0].event;
        await execWorker("DELETE FROM event_match_data WHERE event = ?", [
          event,
        ]);
      }

      for (const item of data) {
        await execWorker(
          `INSERT INTO event_match_data
           (event, match, team, alliance, data_raw, data, name, uid, timestamp, last_modified, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event, match, team, uid, timestamp) DO UPDATE SET
           alliance=excluded.alliance, data_raw=excluded.data_raw, data=excluded.data,
           name=excluded.name, last_modified=excluded.last_modified, deleted_at=excluded.deleted_at`,
          [
            item.event,
            item.match,
            item.team,
            item.alliance,
            JSON.stringify(item.data_raw),
            JSON.stringify(item.data),
            item.name,
            item.uid,
            item.timestamp,
            item.last_modified,
            item.deleted_at,
          ],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

export async function getEventPicklists(
  event: string,
): Promise<EventPicklist[]> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT * FROM event_picklist WHERE event = ? AND deleted_at IS NULL",
    [event],
  );
  return (rows as any[]).map((row) => ({
    ...row,
    picklist: row.picklist ? JSON.parse(row.picklist) : null,
  }));
}

export async function cacheEventPicklists(
  picklists: EventPicklist[],
): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    await execWorker("BEGIN TRANSACTION");
    try {
      // Clear old picklists for this event before inserting fresh data
      if (picklists.length > 0) {
        const event = picklists[0].event;
        await execWorker("DELETE FROM event_picklist WHERE event = ?", [event]);
      }

      for (const list of picklists) {
        await execWorker(
          `INSERT INTO event_picklist
           (id, event, title, picklist, uname, uid, type, timestamp, last_modified, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
           event=excluded.event, title=excluded.title, picklist=excluded.picklist,
           uname=excluded.uname, uid=excluded.uid, type=excluded.type,
           timestamp=excluded.timestamp, last_modified=excluded.last_modified,
           deleted_at=excluded.deleted_at`,
          [
            list.id,
            list.event,
            list.title,
            JSON.stringify(list.picklist),
            list.uname,
            list.uid,
            list.type,
            list.timestamp,
            list.last_modified,
            list.deleted_at,
          ],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

export async function getEventPicklistEntries(
  event: string,
  id: string,
): Promise<EventPicklistEntry[]> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT * FROM event_picklist_entries WHERE event = ? AND id = ? AND deleted_at IS NULL ORDER BY rank ASC",
    [event, id],
  );
  return (rows as any[]).map((row) => ({
    ...row,
    flags: row.flags ? JSON.parse(row.flags) : null,
  }));
}

export async function getPicklistById(
  eventKey: string,
  picklistId: string,
): Promise<{
  picklist: EventPicklist | null;
  entries: EventPicklistEntry[];
}> {
  await initDatabase();

  // Get picklist metadata
  const picklistRows = await execWorker(
    "SELECT * FROM event_picklist WHERE event = ? AND id = ? AND deleted_at IS NULL",
    [eventKey, picklistId],
  );

  const picklist = picklistRows.length > 0
    ? {
        ...(picklistRows[0] as any),
        picklist: (picklistRows[0] as any).picklist
          ? JSON.parse((picklistRows[0] as any).picklist)
          : null,
      }
    : null;

  // Get picklist entries sorted by rank
  const entries = await getEventPicklistEntries(eventKey, picklistId);

  return { picklist, entries };
}

export async function cacheEventPicklistEntries(
  entries: EventPicklistEntry[],
): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    await execWorker("BEGIN TRANSACTION");
    try {
      // Clear ALL old entries for this event before inserting fresh data
      // This ensures deleted entries are removed from cache across all picklists
      if (entries.length > 0) {
        const event = entries[0].event;
        await execWorker(
          "DELETE FROM event_picklist_entries WHERE event = ?",
          [event],
        );
      }

      // Insert fresh data (with UPSERT to handle duplicates)
      for (const entry of entries) {
        await execWorker(
          `INSERT INTO event_picklist_entries
           (event, id, team, rank, flags, last_modified, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event, id, team) DO UPDATE SET
           rank=excluded.rank, flags=excluded.flags,
           last_modified=excluded.last_modified, deleted_at=excluded.deleted_at`,
          [
            entry.event,
            entry.id,
            entry.team,
            entry.rank,
            JSON.stringify(entry.flags),
            entry.last_modified,
            entry.deleted_at,
          ],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

// ============ TBA CACHE CRUD ============

export async function getTbaTeams(event: string): Promise<TbaTeam[]> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT * FROM tba_event_teams WHERE event = ? ORDER BY team_number",
    [event],
  );
  return rows as TbaTeam[];
}

export async function cacheTbaTeams(
  event: string,
  teams: TbaTeam[],
): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    const now = Date.now();
    await execWorker("BEGIN TRANSACTION");
    try {
      for (const team of teams) {
        await execWorker(
          `INSERT INTO tba_event_teams 
           (event, team_key, team_number, name, rank, wins, losses, ties, next_match, last_match, last_synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event, team_key) DO UPDATE SET
           team_number=excluded.team_number, name=excluded.name, rank=excluded.rank, 
           wins=excluded.wins, losses=excluded.losses, ties=excluded.ties, 
           next_match=excluded.next_match, last_match=excluded.last_match, last_synced=excluded.last_synced`,
          [
            event,
            team.team_key,
            team.team_number,
            team.name,
            team.rank,
            team.wins,
            team.losses,
            team.ties,
            team.next_match,
            team.last_match,
            now,
          ],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

export async function getTbaMatches(event: string): Promise<TbaMatch[]> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT * FROM tba_event_matches WHERE event = ? ORDER BY est_time",
    [event],
  );
  return (rows as any[]).map((row) => ({
    ...row,
    red_teams: row.red_teams ? JSON.parse(row.red_teams) : [],
    blue_teams: row.blue_teams ? JSON.parse(row.blue_teams) : [],
  }));
}

export async function cacheTbaMatches(
  event: string,
  matches: TbaMatch[],
): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    const now = Date.now();
    await execWorker("BEGIN TRANSACTION");
    try {
      for (const match of matches) {
        await execWorker(
          `INSERT INTO tba_event_matches 
           (event, match_key, comp_level, match_number, est_time, red_teams, blue_teams, red_score, blue_score, last_synced)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(event, match_key) DO UPDATE SET
           comp_level=excluded.comp_level, match_number=excluded.match_number, 
           est_time=excluded.est_time, red_teams=excluded.red_teams, 
           blue_teams=excluded.blue_teams, red_score=excluded.red_score, 
           blue_score=excluded.blue_score, last_synced=excluded.last_synced`,
          [
            event,
            match.match_key,
            match.comp_level,
            match.match_number,
            match.est_time,
            JSON.stringify(match.red_teams),
            JSON.stringify(match.blue_teams),
            match.red_score,
            match.blue_score,
            now,
          ],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

// ============ STATBOTICS CACHE CRUD ============

export async function getStatboticsEpa(
  event: string,
): Promise<StatboticsEpa[]> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT * FROM statbotics_event_team_epa WHERE event = ?",
    [event],
  );
  return (rows as any[]).map((row) => ({
    ...row,
    epa: JSON.parse(row.epa),
  }));
}

export async function cacheStatboticsEpa(data: StatboticsEpa[]): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    const now = Date.now();
    await execWorker("BEGIN TRANSACTION");
    try {
      for (const item of data) {
        await execWorker(
          `INSERT INTO statbotics_event_team_epa (event, team, epa, last_synced)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(event, team) DO UPDATE SET
           epa=excluded.epa, last_synced=excluded.last_synced`,
          [item.event, item.team, JSON.stringify(item.epa), now],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

export async function getStatboticsMatchPred(
  event: string,
): Promise<StatboticsMatchPred[]> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT * FROM statbotics_event_match_pred WHERE event = ?",
    [event],
  );
  return (rows as any[]).map((row) => ({
    ...row,
    pred: JSON.parse(row.pred),
  }));
}

export async function cacheStatboticsMatchPred(
  data: StatboticsMatchPred[],
): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    const now = Date.now();
    await execWorker("BEGIN TRANSACTION");
    try {
      for (const item of data) {
        await execWorker(
          `INSERT INTO statbotics_event_match_pred (event, match, pred, last_synced)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(event, match) DO UPDATE SET
           pred=excluded.pred, last_synced=excluded.last_synced`,
          [item.event, item.match, JSON.stringify(item.pred), now],
        );
      }
      await execWorker("COMMIT");
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

// ============ SYNC QUEUE ============

export async function addToSyncQueue(
  type: string,
  payload: any,
): Promise<void> {
  await initDatabase();
  await execWorker("INSERT INTO sync_queue (type, payload) VALUES (?, ?)", [
    type,
    JSON.stringify(payload),
  ]);
  console.log(`[LocalDB] Added ${type} to sync queue`);
}

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  await initDatabase();
  const rows = await execWorker("SELECT * FROM sync_queue ORDER BY created_at");
  return (rows as any[]).map((row) => ({
    ...row,
    payload: JSON.parse(row.payload),
  })) as SyncQueueItem[];
}

export async function removeSyncQueueItem(id: number): Promise<void> {
  await initDatabase();
  await execWorker("DELETE FROM sync_queue WHERE id = ?", [id]);
}

export async function incrementSyncQueueRetry(
  id: number,
  error?: string,
): Promise<void> {
  await initDatabase();
  await execWorker(
    "UPDATE sync_queue SET retries = retries + 1, last_error = ? WHERE id = ?",
    [error ?? null, id],
  );
}

// ============ UTILITIES ============

export async function clearEventData(event: string): Promise<void> {
  return await withWriteLock(async () => {
    await initDatabase();
    await execWorker("BEGIN TRANSACTION");
    try {
      await execWorker("DELETE FROM event_team_data WHERE event = ?", [event]);
      await execWorker("DELETE FROM event_schedule WHERE event = ?", [event]);
      await execWorker("DELETE FROM event_match_data WHERE event = ?", [event]);
      await execWorker("DELETE FROM event_picklist WHERE event = ?", [event]);
      await execWorker("DELETE FROM event_picklist_entries WHERE event = ?", [
        event,
      ]);
      await execWorker("DELETE FROM tba_event_teams WHERE event = ?", [event]);
      await execWorker("DELETE FROM tba_event_matches WHERE event = ?", [
        event,
      ]);
      await execWorker(
        "DELETE FROM statbotics_event_team_epa WHERE event = ?",
        [event],
      );
      await execWorker(
        "DELETE FROM statbotics_event_match_pred WHERE event = ?",
        [event],
      );
      await execWorker("COMMIT");
      console.log(`[LocalDB] Cleared all data for ${event}`);
    } catch (e) {
      await execWorker("ROLLBACK");
      throw e;
    }
  });
}

export async function getLastSyncTime(event: string): Promise<number> {
  await initDatabase();
  const rows = await execWorker(
    "SELECT MAX(last_synced) as last_synced FROM tba_event_teams WHERE event = ?",
    [event],
  );
  return (rows?.[0]?.last_synced ?? 0) as number;
}
