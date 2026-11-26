import "server-only";
import type { PoolClient } from "pg";

export type Status = {
  id: string; name: string; color: string; code: number | null; sort_order: number;
  counts_as_done: boolean; not_a_shot: boolean; back_to_artist: boolean; allowed: string[];
};

export type Shot = {
  id: string; shot_num: string; act: string | null; sequence: string | null; slate: string | null;
  timecodes: string | null; duration: string | null; brief: string; boards: { url: string; name?: string }[];
  artist_id?: string | null; artist_name?: string | null; status_id: string | null; due_date?: string | null;
  drive_url: string | null; director_notes: string; showrunner_notes: string; elves_notes: string; sort_order: number;
};

export type Note = { id: string; shot_id: string; author_name: string; body: string; created_at: string };
export type LastChange = { shot_id: string; to_name: string | null; from_name: string | null; changed_by_name: string | null; changed_at: string };

// Columns a Shot Tracker can show, in the default order (same as the Coda Admin View).
export const TRACKER_COLUMNS = [
  { k: "shot_num", t: "Shot #" },
  { k: "act", t: "Act" },
  { k: "sequence", t: "Sequence" },
  { k: "slate", t: "Slate" },
  { k: "artist", t: "Artist", hideFor: ["client"] },
  { k: "due_date", t: "Due date", hideFor: ["client"] },
  { k: "timecodes", t: "Timecodes" },
  { k: "duration", t: "Duration" },
  { k: "drive", t: "Drive folder" },
  { k: "status", t: "Status" },
  { k: "brief", t: "Brief" },
  { k: "boards", t: "Boards" },
  { k: "director_notes", t: "Director notes" },
  { k: "internal_notes", t: "Internal notes", hideFor: ["client"] },
  { k: "showrunner_notes", t: "Showrunner Notes" },
  { k: "elves_notes", t: "Elves Notes" },
] as const;
export type ColumnKey = (typeof TRACKER_COLUMNS)[number]["k"];

export function projectColumns(project: { tracker_columns: string[]; column_labels: Record<string, string> }, userType: string) {
  const keys = project.tracker_columns?.length ? project.tracker_columns : TRACKER_COLUMNS.map((c) => c.k);
  return keys
    .map((k) => TRACKER_COLUMNS.find((c) => c.k === k))
    .filter((c): c is (typeof TRACKER_COLUMNS)[number] => !!c)
    .filter((c) => !("hideFor" in c) || !(c.hideFor as readonly string[]).includes(userType))
    .map((c) => ({ k: c.k as ColumnKey, t: project.column_labels?.[c.k] || c.t }));
}

// "5s", "5", "0:05", "1:05", "4 secs", "1 min 5 secs" → seconds
export function seconds(v: string | null | undefined): number {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t) return 0;
  if (/^\d+:\d{1,2}(\.\d+)?$/.test(t)) { const [m, s] = t.split(":").map(Number); return m * 60 + s; }
  const parts = [...t.matchAll(/([\d.]+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/g)];
  if (parts.length) return parts.reduce((a, [, n, u]) => a + Number(n) * (u.startsWith("h") ? 3600 : u.startsWith("m") ? 60 : 1), 0);
  return parseFloat(t) || 0;
}

// Episode count. The number of shots is the number of rows (team decision, Nov 25 2026).
// Slates = distinct SLATE values; duration = one duration per slate (the first row of each slate).
export function episodeCount(shots: Pick<Shot, "slate" | "duration" | "status_id">[], _statuses: Status[], withSlates = true) {
  const per = new Map<string, number>();
  for (const s of shots) {
    const key = (s.slate ?? "").trim();
    if (key && !per.has(key)) per.set(key, seconds(s.duration));
  }
  const total = [...per.values()].reduce((a, b) => a + b, 0);
  const m = Math.floor(total / 60), x = Math.round(total % 60);
  const dur = [m ? `${m} minute${m === 1 ? "" : "s"}` : "", x || !m ? `${x} second${x === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  const n = shots.length;
  const text = withSlates && per.size
    ? `${per.size} slate${per.size === 1 ? "" : "s"}, ${n} shot${n === 1 ? "" : "s"} - approx ${dur}`
    : `${n} shot${n === 1 ? "" : "s"}`;
  return { slates: per.size, shots: n, seconds: total, text };
}

export function progress(shots: Pick<Shot, "status_id">[], statuses: Status[]) {
  const notShot = new Set(statuses.filter((s) => s.not_a_shot).map((s) => s.id));
  const done = new Set(statuses.filter((s) => s.counts_as_done).map((s) => s.id));
  const list = shots.filter((s) => !(s.status_id && notShot.has(s.status_id)));
  const d = list.filter((s) => s.status_id && done.has(s.status_id)).length;
  return { done: d, total: list.length, pct: list.length ? Math.round((d * 100) / list.length) : 0 };
}

export async function projectStatuses(db: PoolClient, projectId: string): Promise<Status[]> {
  return (await db.query<Status>(
    `select s.id, s.name, s.color, s.code, s.sort_order, s.counts_as_done, s.not_a_shot, s.back_to_artist,
            coalesce(array_agg(sp.user_type::text) filter (where sp.user_type is not null), '{}') as allowed
       from statuses s left join status_permissions sp on sp.status_id = s.id
      where s.project_id = $1 group by s.id order by s.sort_order`, [projectId])).rows;
}

/** Statuses this person may pick for this shot (the current one first). Empty = read only. */
export function statusChoices(shot: Shot, statuses: Status[], me: { id: string; user_type: string }, manager: boolean) {
  if (manager) return statuses;
  const mine = statuses.filter((s) => s.allowed.includes(me.user_type));
  if (!mine.length) return [];
  if (me.user_type === "artist" && shot.artist_id !== me.id) return [];
  const cur = statuses.find((s) => s.id === shot.status_id);
  if (cur && !cur.allowed.includes(me.user_type) && !cur.back_to_artist) return [];
  return cur && !mine.some((s) => s.id === cur.id) ? [cur, ...mine] : mine;
}

export const fmtShort = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", month: "short", day: "numeric" }).format(new Date(iso));
export const fmtWhen = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
export const fmtDay = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
