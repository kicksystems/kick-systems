// Calendar model for Kick Systems, ported from RegiStar Schedule (Manus):
// shared/calendar.ts (titles, order), server/calendarDeadlines.ts (preparation deadline),
// server/calendarMoveWrites.ts (grouped writes), server/calendarData.ts (labels), shared/calendarProgress.ts.
import { addWorkingDays, isDateKey, planRipple, type RippleChange } from "./scheduling";

export type Category = { id: string; label: string; short: string; description: string; color: string };
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "recre", label: "RECRE DUE DATES", short: "Recreation deadlines", description: "Recreation deadlines from the source calendar.", color: "#4f9a6a" },
  { id: "rc", label: "NEW RC EPISODES AVAIL FOR RECRE", short: "RC available", description: "Episodes with RC notes due, ready for recreation planning.", color: "#4f7fc4" },
  { id: "possible", label: "POSSIBLE FC/LC REQUESTS", short: "Possible FC/LC", description: "FC, LC, and LC2 notes due. These are possible requests, not confirmed recre deadlines.", color: "#9a74cc" },
  { id: "online", label: "ONLINE IS HAPPENING", short: "Online mix", description: "Every scheduled online mix day, including mix sessions.", color: "#c09430" },
  { id: "deliver", label: "DELIVER DATES", short: "Deliver", description: "Episode delivery dates from the source calendar.", color: "#c4646a" },
];

export type Settings = {
  project_id: string; name: string; working_days: number[]; prep_category: string | null; prep_lead_days: number;
  prep_name: string; categories: Category[]; revision: number; updated_at: string;
};

export type Row = {
  id: string; episode: string; category: string; title: string; date: string; stage: string | null;
  ripple_linked: boolean; origin: "import" | "manual"; prep_date: string | null; prep_hidden: boolean;
};

export type CalEvent = {
  id: string; rowId: string; episode: string; category: string; date: string; title: string; label: string;
  stage: string | null; rippleLinked: boolean; kind: "event" | "delivery" | "prep"; origin: string;
};

export const prepId = (rowId: string) => `prep:${rowId}`;
export const autoPrepDate = (date: string, s: Pick<Settings, "working_days" | "prep_lead_days">) =>
  addWorkingDays(date, -Math.max(0, s.prep_lead_days), s.working_days);

/** Presentation-only titles for the delivery and its preparation (RegiStar recreTitle). */
export function recreTitle(title: string, episode: string, kind: "actual" | "kick", prepName: string): string {
  const esc = episode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutEpisode = title.replace(new RegExp(`^${esc}\\s+`), "").replace(/^🚩\s*/, "");
  const label = kind === "kick"
    ? withoutEpisode.replace(/RECRE DUE(?:\s+KICK)?/gi, prepName).replace(/RECRE DELIVERY/gi, prepName).replace(/\s+KICK$/i, "")
    : withoutEpisode.replace(/RECRE DUE/gi, "RECRE DELIVERY");
  const has = kind === "kick" ? label.includes(prepName) : /RECRE DELIVERY/i.test(label);
  const fallback = label === withoutEpisode && !has ? `${label} · ${kind === "kick" ? prepName : "RECRE DELIVERY"}` : label;
  return `${kind === "kick" ? "🚩 " : ""}${episode} ${fallback}`;
}

function displayLabel(e: Omit<CalEvent, "label">): string {
  const esc = e.episode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (e.kind === "prep") return "🚩 " + e.title.replace(/^🚩\s*/, "").replace(new RegExp(`^${esc}\\s+`), "");
  if (e.origin === "manual" || e.kind === "delivery") return e.title.replace(new RegExp(`^${esc}\\s+`), "");
  if (e.category === "rc") return `${e.stage ?? "RC"} available`;
  if (e.category === "possible") return `${e.stage ?? "FC/LC"} request?`;
  if (e.category === "online") return /SESSION/i.test(e.title) ? "Mix session" : "Online mix";
  if (e.category === "deliver") return /2 hour/i.test(e.title) ? "Deliver · 2 hour" : "Deliver";
  return e.title.replace(/^\d+\s+/, "").replace("RECRE DUE", "Recre due");
}

/** Every visible calendar entry: each row, plus a preparation deadline for rows in the preparation category. */
export function visibleEvents(rows: Row[], s: Settings): CalEvent[] {
  const order = (c: string) => { const i = s.categories.findIndex((x) => x.id === c); return i < 0 ? 99 : i; };
  const out: CalEvent[] = [];
  for (const r of rows) {
    const base = { rowId: r.id, episode: r.episode, category: r.category, stage: r.stage, origin: r.origin };
    if (r.category !== s.prep_category) {
      const e = { ...base, id: r.id, date: r.date, title: r.title, rippleLinked: r.ripple_linked, kind: "event" as const };
      out.push({ ...e, label: displayLabel(e) });
      continue;
    }
    const d = { ...base, id: r.id, date: r.date, title: recreTitle(r.title, r.episode, "actual", s.prep_name), rippleLinked: r.ripple_linked, kind: "delivery" as const };
    out.push({ ...d, label: displayLabel(d) });
    if (r.prep_hidden) continue;
    let date: string;
    try { date = r.prep_date ?? autoPrepDate(r.date, s); } catch { continue; }
    const p = { ...base, id: prepId(r.id), date, title: recreTitle(r.title, r.episode, "kick", s.prep_name), rippleLinked: true, kind: "prep" as const };
    out.push({ ...p, label: displayLabel(p) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || order(a.category) - order(b.category)
    || a.episode.localeCompare(b.episode, undefined, { numeric: true }) || a.id.localeCompare(b.id));
}

export type RowWrite = { id: string; before: { date: string; prep_date: string | null }; after: { date: string; prep_date: string | null } };

/**
 * Plans a move and turns it into one write per physical row (delivery and preparation share a row).
 * An unselected or earlier preparation keeps its date instead of being silently re-derived.
 */
export function planMove(rows: Row[], s: Settings, eventId: string, target: string, categories: string[]) {
  const events = visibleEvents(rows, s);
  const plan = planRipple(events.map((e) => ({ id: e.id, episode: e.episode, category: e.category, date: e.date, title: e.title, rippleLinked: e.rippleLinked })),
    eventId, target, s.working_days, categories);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const evById = new Map(events.map((e) => [e.id, e]));
  const groups = new Map<string, RippleChange[]>();
  for (const c of plan.changes) {
    const rowId = evById.get(c.eventId)?.rowId;
    if (!rowId) throw new Error("A moved event is no longer available.");
    groups.set(rowId, [...(groups.get(rowId) ?? []), c]);
  }
  const writes: RowWrite[] = [];
  for (const [rowId, items] of groups) {
    const r = byId.get(rowId)!;
    const actual = items.find((c) => c.eventId === rowId), prep = items.find((c) => c.eventId === prepId(rowId));
    const nextDate = actual?.to ?? r.date;
    let nextPrep = r.prep_date;
    if (r.category === s.prep_category) {
      const oldPrep = evById.get(prepId(rowId))?.date;
      const desired = prep?.to ?? oldPrep ?? r.prep_date ?? autoPrepDate(r.date, s);
      nextPrep = r.prep_date === null && desired === autoPrepDate(nextDate, s) ? null : desired;
      if (r.prep_hidden && !prep) nextPrep = r.prep_date;
    }
    writes.push({ id: rowId, before: { date: r.date, prep_date: r.prep_date }, after: { date: nextDate, prep_date: nextPrep } });
  }
  const changes = plan.changes.map((c) => ({ ...c, title: evById.get(c.eventId)?.label ?? c.title }));
  return { delta: plan.delta, changes, writes };
}

/** Online progress (RegiStar calendarProgress): each episode counts once when its first Online date is today or earlier. */
export function onlineProgress(events: CalEvent[], today: string) {
  if (!isDateKey(today)) throw new Error("Use a valid calendar day for Online progress.");
  const first = new Map<string, string | null>();
  for (const e of events) {
    if (!e.episode) continue;
    if (!first.has(e.episode)) first.set(e.episode, null);
    if (e.category !== "online") continue;
    const prev = first.get(e.episode);
    if (!prev || e.date < prev) first.set(e.episode, e.date);
  }
  const episodes = [...first.entries()].map(([episode, d]) => ({ episode, firstOnlineDate: d, reached: d !== null && d <= today }))
    .sort((a, b) => a.episode.localeCompare(b.episode, undefined, { numeric: true }));
  const total = episodes.length, reached = episodes.filter((e) => e.reached).length;
  const next = episodes.filter((e) => e.firstOnlineDate && !e.reached).sort((a, b) => a.firstOnlineDate!.localeCompare(b.firstOnlineDate!))[0] ?? null;
  return { total, reached, percent: total ? Math.round((reached / total) * 100) : 0, next };
}
