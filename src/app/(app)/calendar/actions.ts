"use server";
import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import { requireAdmin, requireMe, type Me } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { isDateKey, isWorkingDay } from "@/lib/cal/scheduling";
import { planMove, type Category } from "@/lib/cal/model";
import { latestChange, loadRows, lockSettings, rowStates, type RowState } from "@/lib/cal/data";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const uuid = (v: string) => { if (!/^[0-9a-f-]{36}$/.test(v)) throw new Error("Bad id."); return v; };
// Back to the calendar view the person was on, without the one-time keys of the previous answer.
const back = (fd: FormData, extra = "", drop: string[] = []) => {
  const b = s(fd, "back");
  const u = new URL(b.startsWith("/calendar") ? b : "/calendar", "http://x");
  for (const k of ["err", "ok", "feed", "to", ...drop]) u.searchParams.delete(k);
  if (extra) { const [k, v] = extra.split("="); u.searchParams.set(k, decodeURIComponent(v ?? "")); }
  return u.pathname + (u.search || "");
};

class CalendarError extends Error {}

async function manage(me: Me, projectId: string, fn: (db: PoolClient, revision: number) => Promise<{ kind: string; summary: string; ids: string[]; before: RowState[]; changes?: unknown[] } | null>) {
  return asUser(me.id, async (db) => {
    const ok = (await db.query("select public.can_manage_project($1) as ok", [projectId])).rows[0].ok;
    if (!ok) throw new CalendarError("Only admins and the director change the calendar.");
    const set = await lockSettings(db, projectId);
    const res = await fn(db, set.revision);
    if (!res) return;
    const after = await rowStates(db, res.ids);
    const revision = set.revision + 1;
    await db.query("update calendar_settings set revision = $2, updated_at = now() where project_id = $1", [projectId, revision]);
    await db.query(
      `insert into calendar_changes (project_id, actor_id, actor_name, kind, summary, rows_before, rows_after, changes, result_revision)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [projectId, me.id, me.full_name, res.kind, res.summary, JSON.stringify(res.before), JSON.stringify(after), JSON.stringify(res.changes ?? []), revision]);
  });
}

function fail(fd: FormData, e: unknown): never {
  const msg = e instanceof Error ? e.message : "Something went wrong.";
  redirect(back(fd, `err=${encodeURIComponent(msg.slice(0, 200))}`));
}

export async function addEvent(fd: FormData) {
  const me = await requireMe();
  const pid = uuid(s(fd, "project"));
  const episode = s(fd, "episode"), title = s(fd, "title"), category = s(fd, "category"), date = s(fd, "date");
  try {
    if (!/^[\w.-]{1,12}$/.test(episode)) throw new CalendarError("Enter the episode number.");
    if (!title || title.length > 180 || /[\u0000-\u001f]/.test(title)) throw new CalendarError("Enter a one-line title.");
    if (!isDateKey(date)) throw new CalendarError("Choose a valid date between 2020 and 2100.");
    await manage(me, pid, async (db) => {
      const set = await lockSettings(db, pid);
      if (!set.categories.some((c) => c.id === category)) throw new CalendarError("Choose a category.");
      if (!isWorkingDay(date, set.working_days)) throw new CalendarError("New events must fall on a working day.");
      const full = title.startsWith(episode + " ") ? title : `${episode} ${title}`;
      const id = (await db.query(
        `insert into calendar_events (project_id, episode, category, title, date, ripple_linked, origin, created_by)
         values ($1,$2,$3,$4,$5,$6,'manual',$7) returning id`,
        [pid, episode, category, full, date, fd.get("ripple") === "on", me.id])).rows[0].id as string;
      return { kind: "create", summary: `Added ${full}`, ids: [id], before: [] };
    });
  } catch (e) { fail(fd, e); }
  revalidatePath("/calendar");
  redirect(back(fd, "ok=added"));
}

export async function moveEvent(fd: FormData) {
  const me = await requireMe();
  const pid = uuid(s(fd, "project"));
  const eventId = s(fd, "event"), to = s(fd, "to"), expected = Number(s(fd, "revision"));
  const ripple = fd.get("ripple") === "on";
  try {
    await manage(me, pid, async (db, revision) => {
      if (revision !== expected) throw new CalendarError("The schedule changed in another session. Review the preview again.");
      const set = await lockSettings(db, pid);
      const rows = await loadRows(db, pid);
      const cats = ripple ? fd.getAll("cats").map(String).filter((c) => set.categories.some((x) => x.id === c)) : [];
      const plan = planMove(rows, set, eventId, to, cats);
      if (!plan.writes.length) return null;
      const before = await rowStates(db, plan.writes.map((w) => w.id));
      for (const w of plan.writes) {
        const r = await db.query(
          `update calendar_events set date = $2, prep_date = $3
            where id = $1 and date = $4 and prep_date is not distinct from $5::date and deleted_at is null`,
          [w.id, w.after.date, w.after.prep_date, w.before.date, w.before.prep_date]);
        if (r.rowCount !== 1) throw new CalendarError("The schedule changed in another session. Review the preview again.");
      }
      const anchor = plan.changes.find((c) => c.eventId === eventId);
      return { kind: "move", summary: `${anchor?.episode ?? ""} ${anchor?.title ?? ""}: ${anchor?.from} → ${anchor?.to}${plan.changes.length > 1 ? ` (+${plan.changes.length - 1} linked)` : ""}`,
        ids: plan.writes.map((w) => w.id), before, changes: plan.changes };
    });
  } catch (e) { fail(fd, e); }
  revalidatePath("/calendar");
  redirect(back(fd, "ok=moved", ["e"]));
}

export async function deleteEvent(fd: FormData) {
  const me = await requireMe();
  const pid = uuid(s(fd, "project"));
  const eventId = s(fd, "event");
  const isPrep = eventId.startsWith("prep:");
  const rowId = uuid(isPrep ? eventId.slice(5) : eventId);
  try {
    await manage(me, pid, async (db) => {
      const before = await rowStates(db, [rowId]);
      if (!before.length || before[0].deleted) throw new CalendarError("This event is no longer in the calendar.");
      const title = (await db.query("select title from calendar_events where id=$1", [rowId])).rows[0]?.title ?? "";
      if (isPrep) await db.query("update calendar_events set prep_hidden = true where id = $1 and project_id = $2", [rowId, pid]);
      else await db.query("update calendar_events set deleted_at = now() where id = $1 and project_id = $2", [rowId, pid]);
      return { kind: isPrep ? "prepdel" : "delete", summary: `${isPrep ? "Removed the preparation of" : "Deleted"} ${title}`, ids: [rowId], before };
    });
  } catch (e) { fail(fd, e); }
  revalidatePath("/calendar");
  redirect(back(fd, "ok=deleted", ["e"]));
}

// Undo: only your latest action, while nothing changed after it. Restores exactly the saved rows.
export async function undoLast(fd: FormData) {
  const me = await requireMe();
  const pid = uuid(s(fd, "project"));
  try {
    await manage(me, pid, async (db, revision) => {
      const last = await latestChange(db, pid);
      if (!last || last.actor_id !== me.id || last.result_revision !== revision || !["move", "create", "delete", "prepdel"].includes(last.kind)) {
        throw new CalendarError("Only your latest unchanged calendar action can be undone.");
      }
      const ids = last.rows_after.map((r) => r.id).concat(last.rows_before.map((r) => r.id));
      const uniq = [...new Set(ids)];
      const now = await rowStates(db, uniq);
      const same = (a: RowState, b: RowState) => a.date === b.date && a.prep_date === b.prep_date && a.prep_hidden === b.prep_hidden && a.deleted === b.deleted;
      for (const a of last.rows_after) {
        const cur = now.find((x) => x.id === a.id);
        if (!cur || !same(cur, a)) throw new CalendarError("The schedule changed since then, so it cannot be undone.");
      }
      if (last.kind === "create") {
        await db.query("delete from calendar_events where id = any($1) and project_id = $2 and origin = 'manual'", [last.rows_after.map((r) => r.id), pid]);
      } else {
        for (const b of last.rows_before) {
          await db.query(
            "update calendar_events set date=$2, prep_date=$3, prep_hidden=$4, deleted_at = case when $5 then coalesce(deleted_at, now()) end where id=$1 and project_id=$6",
            [b.id, b.date, b.prep_date, b.prep_hidden, b.deleted, pid]);
        }
      }
      return { kind: "undo", summary: `Undid: ${last.summary}`, ids: last.kind === "create" ? [] : uniq, before: last.rows_after };
    });
  } catch (e) { fail(fd, e); }
  revalidatePath("/calendar");
  redirect(back(fd, "ok=undone"));
}

// ── Source & rules (admins) ──
export async function saveCalendarSettings(fd: FormData) {
  const me = await requireAdmin();
  const pid = uuid(s(fd, "project"));
  const days = fd.getAll("wd").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const lead = Math.max(0, Math.min(30, Number(s(fd, "lead")) || 0));
  const ids = fd.getAll("cat_id").map(String);
  const cats: Category[] = ids.map((id) => ({
    id, label: s(fd, `cat_label_${id}`) || id, short: s(fd, `cat_short_${id}`) || s(fd, `cat_label_${id}`) || id,
    description: s(fd, `cat_desc_${id}`), color: /^#[0-9a-f]{6}$/i.test(s(fd, `cat_color_${id}`)) ? s(fd, `cat_color_${id}`) : "#999999",
  })).filter((c) => fd.get(`cat_remove_${c.id}`) !== "on");
  const newLabel = s(fd, "new_label");
  if (newLabel) {
    const id = newLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || `cat-${cats.length + 1}`;
    if (!cats.some((c) => c.id === id)) cats.push({ id, label: newLabel, short: newLabel, description: s(fd, "new_desc"), color: /^#[0-9a-f]{6}$/i.test(s(fd, "new_color")) ? s(fd, "new_color") : "#777777" });
  }
  try {
    if (!days.length) throw new CalendarError("Keep at least one working day.");
    if (!cats.length) throw new CalendarError("Keep at least one category.");
    await asUser(me.id, async (db) => {
      await lockSettings(db, pid);
      const used = (await db.query("select distinct category from calendar_events where project_id=$1 and deleted_at is null", [pid])).rows.map((r) => r.category as string);
      const missing = used.filter((u) => !cats.some((c) => c.id === u));
      if (missing.length) throw new CalendarError(`Category in use, cannot be removed: ${missing.join(", ")}.`);
      const prepCat = s(fd, "prep_category");
      await db.query(
        `update calendar_settings set name=$2, working_days=$3, prep_lead_days=$4, prep_name=$5, prep_category=nullif($6,''), categories=$7, updated_at=now() where project_id=$1`,
        [pid, s(fd, "name") || "Calendar", days, lead, s(fd, "prep_name") || "RECRE DUE, EDIT, LAST LOOKS", cats.some((c) => c.id === prepCat) ? prepCat : "", JSON.stringify(cats)]);
      await db.query(
        `insert into calendar_source (project_id, team_rules) values ($1,$2) on conflict (project_id) do update set team_rules=excluded.team_rules, updated_at=now()`,
        [pid, String(fd.get("team_rules") ?? "")]);
    });
  } catch (e) { fail(fd, e); }
  revalidatePath("/calendar");
  redirect(back(fd, "ok=saved"));
}

// ── Read-only feeds for Google / Apple / Outlook calendars ──
export async function createFeed(fd: FormData) {
  const me = await requireMe();
  const pid = uuid(s(fd, "project"));
  const cats = fd.getAll("cats").map(String);
  const token = randomBytes(32).toString("hex");
  try {
    if (!cats.length) throw new CalendarError("Choose at least one category.");
    await asUser(me.id, (db) => db.query(
      "insert into calendar_feeds (project_id, owner_id, label, categories, token_hash) values ($1,$2,$3,$4,$5)",
      [pid, me.id, s(fd, "label") || "My calendar", cats, createHash("sha256").update(token).digest("hex")]));
  } catch (e) { fail(fd, e); }
  revalidatePath("/calendar");
  // The link exists only in this answer. Only its hash is stored.
  redirect(back(fd, `feed=${token}`));
}

export async function revokeFeed(fd: FormData) {
  const me = await requireMe();
  await asUser(me.id, (db) => db.query("update calendar_feeds set revoked_at = now() where id = $1 and owner_id = $2", [uuid(s(fd, "id")), me.id]));
  revalidatePath("/calendar");
  redirect(back(fd, "ok=revoked"));
}

