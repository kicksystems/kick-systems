import { createHash } from "node:crypto";
import { asUser, pool } from "@/lib/db";
import { loadRows, loadSettings } from "@/lib/cal/data";
import { visibleEvents } from "@/lib/cal/model";
import { buildCalendarIcs } from "@/lib/cal/ics";

// Read-only calendar feed (ICS) for Google, Apple and Outlook. GET and HEAD only.
// The link is a secret: whoever has it reads the categories chosen for it, with the owner's current access.
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, private, max-age=0", "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer",
};
const unavailable = () => new Response("Calendar subscription unavailable.", { status: 404, headers });

async function feed(token: string) {
  const t = token.replace(/\.ics$/, "");
  if (!/^[0-9a-f]{64}$/.test(t)) return unavailable();
  try {
    const row = (await pool.query(
      `select f.id, f.project_id, f.owner_id, f.label, f.categories, p.name as project
         from calendar_feeds f join projects p on p.id = f.project_id join profiles pr on pr.id = f.owner_id
        where f.token_hash = $1 and f.revoked_at is null and pr.is_active`, [createHash("sha256").update(t).digest("hex")])).rows[0];
    if (!row) return unavailable();
    // Read as the owner, so the database applies their current access.
    const body = await asUser(row.owner_id, async (db) => {
      const ok = (await db.query("select public.can_view_calendar($1) as ok", [row.project_id])).rows[0].ok;
      if (!ok) return null;
      const settings = await loadSettings(db, row.project_id);
      const rows = await loadRows(db, row.project_id);
      const cats = (row.categories as string[]).filter((c) => settings.categories.some((x) => x.id === c));
      const events = visibleEvents(rows, settings).filter((e) => cats.includes(e.category))
        .map((e) => ({ id: e.id, title: `${e.episode} ${e.label}`, category: e.category, date: e.date }));
      return buildCalendarIcs({
        events, calendarName: `${row.project} · ${row.label}`, uidNamespace: `kick/${row.project_id}/${row.id}`,
        updatedAt: Date.parse(settings.updated_at) || 0, revision: settings.revision,
        categoryLabel: (id) => settings.categories.find((c) => c.id === id)?.label ?? id,
      });
    });
    if (body === null) return unavailable();
    return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="kick-systems.ics"' } });
  } catch {
    return new Response("Calendar subscription temporarily unavailable.", { status: 503, headers });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  return feed((await params).token);
}
export async function HEAD(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const r = await GET(req, ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
