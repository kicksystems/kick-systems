import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMe } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";
import { todayBRT } from "@/lib/checklist";
import { fmtWhen } from "@/lib/shots";
import { onlineProgress, planMove, visibleEvents, type CalEvent } from "@/lib/cal/model";
import { latestChange, loadRows, loadSettings, ISO } from "@/lib/cal/data";
import { addEvent, createFeed, deleteEvent, moveEvent, revokeFeed, saveCalendarSettings, undoLast } from "./actions";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();
const fmtDay = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const fmtLong = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });
const monthName = (m: string) => new Date(m + "-01T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const me = await requireMe();
  if (me.user_type === "client") notFound();
  const sp = await searchParams;
  const admin = me.user_type === "admin";

  const data = await asUser(me.id, async (db) => {
    const projects = (await db.query<{ id: string; name: string }>(
      "select id, name from projects where not is_archived and public.can_view_calendar(id) order by name")).rows;
    const pid = projects.find((p) => p.id === one(sp.p))?.id ?? projects.find((p) => /peks/i.test(p.name))?.id ?? projects[0]?.id;
    if (!pid) return null;
    const manager = (await db.query("select public.can_manage_project($1) as ok", [pid])).rows[0].ok as boolean;
    const settings = await loadSettings(db, pid);
    const rows = await loadRows(db, pid);
    const last = manager ? await latestChange(db, pid) : null;
    const feeds = (await db.query<{ id: string; label: string; categories: string[]; created_at: string }>(
      `select id, label, categories, ${ISO("created_at")} as created_at from calendar_feeds where project_id=$1 and owner_id=$2 and revoked_at is null order by created_at desc`, [pid, me.id])).rows;
    const source = admin ? (await db.query<{ source: Record<string, string> | null; team_rules: string }>("select source, team_rules from calendar_source where project_id=$1", [pid])).rows[0] ?? null : null;
    const sourceRows = admin ? (await db.query<{ id: string; source_label: string; source_cells: string[] }>("select id, source_label, source_cells from calendar_events where project_id=$1 and deleted_at is null and origin='import'", [pid])).rows : [];
    return { projects, pid, manager, settings, rows, last, feeds, source, sourceRows };
  });
  if (!data) return <div className="card p-8 text-center text-muted">No calendar is shared with you yet.</div>;
  const { projects, pid, manager, settings, rows, last, feeds, source, sourceRows } = data;

  const today = todayBRT();
  const view = one(sp.view) === "list" ? "list" : one(sp.view) === "source" && admin ? "source" : "month";
  const month = /^\d{4}-\d{2}$/.test(one(sp.m)) ? one(sp.m) : today.slice(0, 7);
  const cats = settings.categories;
  const catOf = (id: string) => cats.find((c) => c.id === id) ?? { id, label: id, short: id, description: "", color: "#999999" };
  const selCats = many(sp.c).length ? many(sp.c) : cats.map((c) => c.id);
  const ep = one(sp.ep), q = one(sp.q).toLowerCase();
  const all = visibleEvents(rows, settings);
  const shown = all.filter((e) => selCats.includes(e.category) && (!ep || e.episode === ep) && (!q || `${e.episode} ${e.label} ${e.title}`.toLowerCase().includes(q)));
  const episodes = [...new Set(all.map((e) => e.episode))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const prog = onlineProgress(all, today);

  // Keep the current view in every link
  const keep = (over: Record<string, string | string[] | null>) => {
    const u = new URLSearchParams();
    const base: Record<string, string | string[]> = { p: pid, view, m: month, ...(many(sp.c).length ? { c: many(sp.c) } : {}), ...(ep ? { ep } : {}), ...(one(sp.q) ? { q: one(sp.q) } : {}), ...(one(sp.e) ? { e: one(sp.e) } : {}) };
    for (const [k, v] of Object.entries({ ...base, ...over })) { if (v === null) continue; for (const x of Array.isArray(v) ? v : [v]) u.append(k, x); }
    return `/calendar?${u.toString()}`;
  };
  const here = keep({});

  const selected = all.find((e) => e.id === one(sp.e)) ?? null;
  const moveTo = one(sp.to);
  // Before the first preview everything is ticked; after it, exactly what the person ticked (nothing = only this event).
  const rippleOn = !moveTo || one(sp.ripple) === "1";
  const moveCats = moveTo ? many(sp.rc) : cats.map((c) => c.id);
  let preview: ReturnType<typeof planMove> | null = null, previewErr = "";
  if (selected && moveTo && manager) {
    try { preview = planMove(rows, settings, selected.id, moveTo, rippleOn ? moveCats : []); } catch (e) { previewErr = e instanceof Error ? e.message : "This move is not valid."; }
  }
  const canUndo = !!last && last.actor_id === me.id && last.result_revision === settings.revision && ["move", "create", "delete", "prepdel"].includes(last.kind);
  const feedUrl = one(sp.feed) && /^[0-9a-f]{64}$/.test(one(sp.feed)) ? `${process.env.SITE_URL ?? ""}/api/calendar/feed/${one(sp.feed)}.ics` : null;

  const chip = (e: CalEvent) => (
    <Link key={e.id} href={keep({ e: e.id, to: null })} title={`${e.episode} ${e.label} · ${catOf(e.category).label}`}
      className={`block truncate rounded-md px-1.5 py-0.5 text-[12px] leading-snug border hover:brightness-95 ${selected?.id === e.id ? "ring-2 ring-[var(--accent)]" : ""}`}
      style={{ background: `color-mix(in srgb, ${catOf(e.category).color} 16%, var(--surface))`, borderColor: `color-mix(in srgb, ${catOf(e.category).color} 40%, transparent)` }}>
      <b>{e.episode}</b> {e.label}
    </Link>
  );

  return (
    <div className="max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{projects.find((p) => p.id === pid)?.name}</p>
          <h1 className="text-4xl font-bold">Calendar</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {projects.length > 1 && projects.map((p) => <Link key={p.id} href={`/calendar?p=${p.id}`} className={`btn btn-sm ${p.id === pid ? "" : "btn-ghost"}`}>{p.name}</Link>)}
          <Link href={keep({ view: "month", e: null })} className={`btn btn-sm ${view === "month" ? "" : "btn-ghost"}`}>Month</Link>
          <Link href={keep({ view: "list", e: null })} className={`btn btn-sm ${view === "list" ? "" : "btn-ghost"}`}>List</Link>
          {admin && <Link href={keep({ view: "source", e: null })} className={`btn btn-sm ${view === "source" ? "" : "btn-ghost"}`}>Source &amp; rules</Link>}
        </div>
      </div>
      <p className="text-muted mt-1 mb-4">{manager ? "You can add, move and delete events. Every move shows a preview first, and you can undo your latest change." : "Read only."}</p>

      {one(sp.err) && <p role="alert" className="card px-4 py-3 mb-3 text-sm text-danger">{one(sp.err)}</p>}
      {one(sp.ok) && <p className="card px-4 py-3 mb-3 text-sm text-ok">{{ added: "Event added.", moved: "Schedule updated.", deleted: "Event deleted.", undone: "Undone.", saved: "Saved.", revoked: "Link revoked." }[one(sp.ok)] ?? "Done."}</p>}
      {canUndo && last && (
        <form action={undoLast} className="card px-4 py-3 mb-3 flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="project" value={pid} /><input type="hidden" name="back" value={here} />
          <span>Your latest change: <b>{last.summary}</b> <span className="text-muted">· {fmtWhen(last.created_at)}</span></span>
          <SubmitButton className="btn btn-ghost btn-sm ml-auto">Undo</SubmitButton>
        </form>
      )}

      {view === "source" ? (
        <SourceView />
      ) : (
        <>
          <section className="card p-4 mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center">
            <div>
              <p className="label uppercase">Season progress · Online</p>
              <div className="flex items-center gap-3 text-sm mt-1"><div className="bar grow"><i style={{ width: `${prog.percent}%` }} /></div><b>{prog.percent}%</b></div>
              <p className="text-xs text-muted mt-1">{prog.reached} of {prog.total} episodes reached their first Online date{prog.next ? `. Next: ${prog.next.episode} on ${fmtDay(prog.next.firstOnlineDate!)}` : ""}.</p>
            </div>
            <form method="get" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="p" value={pid} /><input type="hidden" name="view" value={view} /><input type="hidden" name="m" value={month} />
              {cats.map((c) => (
                <label key={c.id} className="inline-flex items-center gap-1.5 text-xs rounded-full border border-line px-2 py-1" title={c.description}>
                  <input type="checkbox" name="c" value={c.id} defaultChecked={selCats.includes(c.id)} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />{c.short}
                </label>
              ))}
              <select name="ep" defaultValue={ep} className="input !w-auto" aria-label="Episode"><option value="">All episodes</option>{episodes.map((x) => <option key={x}>{x}</option>)}</select>
              <input type="search" name="q" defaultValue={one(sp.q)} placeholder="Search" className="input !w-40" aria-label="Search" />
              <button className="btn btn-ghost btn-sm">Filter</button>
            </form>
          </section>

          <div className={`grid gap-4 ${selected || manager ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
            <div className="min-w-0">
              {view === "month" ? <Month /> : <List />}
            </div>
            {(selected || manager) && <aside className="grid gap-4 content-start">{selected ? <Details e={selected} /> : null}{manager && !selected && <AddForm />}<Feeds /></aside>}
          </div>
          {!manager && !selected && <div className="mt-4"><Feeds /></div>}
        </>
      )}
    </div>
  );

  function Month() {
    const first = `${month}-01`;
    const start = addDays(first, -dow(first));
    const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const weeks = cells.slice(35).every((d) => !d.startsWith(month)) ? cells.slice(0, 35) : cells;
    const prev = addDays(first, -1).slice(0, 7), next = addDays(first, 32).slice(0, 7);
    return (
      <section className="card p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <Link className="btn btn-ghost btn-sm" href={keep({ m: prev, e: null })} aria-label="Previous month">‹</Link>
          <h2 className="font-display text-xl font-semibold uppercase">{monthName(month)}</h2>
          <div className="flex gap-2"><Link className="btn btn-ghost btn-sm" href={keep({ m: today.slice(0, 7), e: null })}>Today</Link><Link className="btn btn-ghost btn-sm" href={keep({ m: next, e: null })} aria-label="Next month">›</Link></div>
        </div>
        <div className="scroll !border-0">
          <div className="grid grid-cols-7 gap-1 min-w-[720px]">
            {WD.map((d, i) => <div key={d} className={`text-xs font-bold text-muted px-1 ${settings.working_days.includes(i) ? "" : "opacity-60"}`}>{d}</div>)}
            {weeks.map((d) => {
              const evs = shown.filter((e) => e.date === d);
              return (
                <div key={d} className={`min-h-[104px] rounded-lg border p-1 ${d.startsWith(month) ? "bg-surface border-line" : "bg-surface2 border-transparent opacity-70"} ${d === today ? "!border-[var(--accent)] border-2" : ""} ${settings.working_days.includes(dow(d)) ? "" : "bg-[color-mix(in_srgb,var(--ink)_3%,var(--surface))]"}`}>
                  <div className={`text-xs mb-1 ${d === today ? "text-accent font-bold" : "text-muted"}`}>{Number(d.slice(8))}</div>
                  <div className="grid gap-0.5">{evs.slice(0, 5).map(chip)}{evs.length > 5 && <Link href={keep({ view: "list", e: null })} className="text-[11px] text-muted underline">+{evs.length - 5} more</Link>}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  function List() {
    const upcoming = shown.filter((e) => one(sp.past) === "1" || e.date >= today);
    const days = [...new Set(upcoming.map((e) => e.date))];
    return (
      <section className="card p-4">
        <div className="flex justify-between items-center mb-2"><h2 className="font-display text-xl font-semibold uppercase">{one(sp.past) === "1" ? "All dates" : "From today"}</h2>
          <Link className="text-sm underline text-muted" href={keep({ past: one(sp.past) === "1" ? null : "1" })}>{one(sp.past) === "1" ? "Hide past dates" : "Show past dates"}</Link></div>
        <ul className="grid gap-3">
          {days.map((d) => (
            <li key={d} className="grid gap-1 sm:grid-cols-[150px_1fr]">
              <b className={`text-sm ${d === today ? "text-accent" : ""}`}>{fmtDay(d)}{d === today ? " · today" : ""}</b>
              <div className="grid gap-1">{upcoming.filter((e) => e.date === d).map(chip)}</div>
            </li>
          ))}
          {!days.length && <li className="text-muted text-sm">No dates match.</li>}
        </ul>
      </section>
    );
  }

  function Details({ e }: { e: CalEvent }) {
    const c = catOf(e.category);
    const src = sourceRows.find((r) => r.id === e.rowId);
    return (
      <section className="card p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="chip" style={{ background: `color-mix(in srgb, ${c.color} 18%, var(--surface))`, color: "var(--ink)" }}>{c.label}</span>
            <h2 className="font-display text-xl font-semibold mt-2">{e.episode} {e.label}</h2>
            <p className="text-sm">{fmtLong(e.date)}</p>
            <p className="text-xs text-muted mt-1">{e.kind === "prep" ? `Preparation of the RECRE delivery, ${settings.prep_lead_days} working day${settings.prep_lead_days === 1 ? "" : "s"} before by default.` : e.rippleLinked ? "Linked to its episode: moves with the episode's later dates." : "Standalone: never moves with other events."}</p>
            {admin && src && (src.source_label || src.source_cells.length > 0) && <p className="text-xs text-muted mt-1">Source: {src.source_label} {src.source_cells.join(", ")}</p>}
          </div>
          <Link href={keep({ e: null, to: null })} className="text-muted hover:text-accent text-xl leading-none" aria-label="Close">×</Link>
        </div>

        {manager && (
          <>
            <form method="get" className="grid gap-2 mt-4 border-t border-line pt-3">
              {Object.entries({ p: pid, view, m: month, e: e.id }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {many(sp.c).map((x) => <input key={x} type="hidden" name="c" value={x} />)}
              <p className="font-semibold text-sm">Move date</p>
              <input type="date" name="to" defaultValue={moveTo || e.date} className="input" required aria-label="New date" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ripple" value="1" defaultChecked={rippleOn} /> Apply ripple (move the linked later dates of episode {e.episode})</label>
              <fieldset className="flex flex-wrap gap-1.5 text-xs">
                <legend className="label mb-1">Categories that move along</legend>
                {cats.map((x) => <label key={x.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5"><input type="checkbox" name="rc" value={x.id} defaultChecked={moveCats.includes(x.id)} />{x.short}</label>)}
              </fieldset>
              <button className="btn btn-ghost btn-sm justify-self-start">Preview</button>
            </form>

            {previewErr && <p className="text-sm text-danger mt-2">{previewErr}</p>}
            {preview && (
              <form action={moveEvent} className="mt-3 grid gap-2">
                <input type="hidden" name="project" value={pid} /><input type="hidden" name="event" value={e.id} /><input type="hidden" name="to" value={moveTo} />
                <input type="hidden" name="revision" value={settings.revision} /><input type="hidden" name="back" value={here} />
                {rippleOn && <input type="hidden" name="ripple" value="on" />}
                {moveCats.map((x) => <input key={x} type="hidden" name="cats" value={x} />)}
                <p className="text-sm"><b>{preview.changes.length}</b> date{preview.changes.length === 1 ? "" : "s"} will change ({preview.delta > 0 ? "+" : ""}{preview.delta} working day{Math.abs(preview.delta) === 1 ? "" : "s"}):</p>
                <ul className="text-xs grid gap-1 max-h-56 overflow-auto">
                  {preview.changes.map((c) => <li key={c.eventId}><b>{c.episode}</b> {c.title}: {fmtDay(c.from)} → <b>{fmtDay(c.to)}</b></li>)}
                </ul>
                {preview.changes.length > 0 && <SubmitButton className="btn btn-sm justify-self-start">Confirm move</SubmitButton>}
              </form>
            )}

            <form action={deleteEvent} className="mt-4 border-t border-line pt-3">
              <input type="hidden" name="project" value={pid} /><input type="hidden" name="event" value={e.id} /><input type="hidden" name="back" value={here} />
              {one(sp.del) === "1"
                ? <div className="flex flex-wrap items-center gap-2 text-sm"><span>{e.kind === "delivery" ? "Delete this delivery and its preparation?" : "Delete this event?"}</span><SubmitButton className="btn btn-danger btn-sm">Yes, delete</SubmitButton><Link href={keep({ del: null })} className="underline text-muted">Cancel</Link></div>
                : <Link href={keep({ del: "1" })} className="btn btn-danger btn-sm">Delete…</Link>}
            </form>
          </>
        )}
      </section>
    );
  }

  function AddForm() {
    return (
      <form action={addEvent} className="card p-4 grid gap-2">
        <input type="hidden" name="project" value={pid} /><input type="hidden" name="back" value={here} />
        <p className="font-display text-lg font-semibold">Add event</p>
        <div className="grid grid-cols-[90px_1fr] gap-2">
          <input name="episode" required placeholder="Ep." className="input" aria-label="Episode" />
          <input name="title" required placeholder="Title, e.g. RECRE DUE" className="input" aria-label="Title" />
        </div>
        <select name="category" className="input" aria-label="Category">{cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <input type="date" name="date" required defaultValue={today} className="input" aria-label="Date" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ripple" defaultChecked /> Linked to its episode (moves with it)</label>
        {settings.prep_category && <p className="text-xs text-muted">{catOf(settings.prep_category).label} events get a 🚩 {settings.prep_name} {settings.prep_lead_days} working day{settings.prep_lead_days === 1 ? "" : "s"} before.</p>}
        <SubmitButton className="btn btn-sm justify-self-start">Add event</SubmitButton>
      </form>
    );
  }

  function Feeds() {
    return (
      <section className="card p-4">
        <p className="font-display text-lg font-semibold">Add to my calendar</p>
        <p className="text-xs text-muted mb-2">A read-only feed for Google, Apple or Outlook calendar, with only the categories you choose. Anyone with the link can read those dates; revoke it any time. Google and Apple decide how often they refresh.</p>
        {feedUrl && (
          <div className="rounded-lg border border-[var(--accent)] p-2 mb-2 text-xs">
            <p className="font-semibold">Your new link (shown only now):</p>
            <code className="break-all">{feedUrl}</code>
            <div className="mt-1"><CopyButton text={feedUrl} /></div>
          </div>
        )}
        <form action={createFeed} className="grid gap-2">
          <input type="hidden" name="project" value={pid} /><input type="hidden" name="back" value={here} />
          <input name="label" placeholder="Name, e.g. My deadlines" className="input" aria-label="Name" />
          <div className="flex flex-wrap gap-1.5 text-xs">{cats.map((c) => <label key={c.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5"><input type="checkbox" name="cats" value={c.id} defaultChecked />{c.short}</label>)}</div>
          <SubmitButton className="btn btn-ghost btn-sm justify-self-start">Create secret link</SubmitButton>
        </form>
        {feeds.length > 0 && (
          <ul className="mt-3 grid gap-1.5 text-sm">
            {feeds.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <span><b>{f.label}</b> <span className="text-xs text-muted">{f.categories.map((c) => catOf(c).short).join(", ")}</span></span>
                <form action={revokeFeed}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="back" value={here} /><SubmitButton className="btn btn-danger btn-sm">Revoke</SubmitButton></form>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  function SourceView() {
    const counts = cats.map((c) => ({ c, n: all.filter((e) => e.category === c.id && e.kind !== "prep").length }));
    const src = source?.source ?? null;
    return (
      <div className="grid gap-4">
        <section className="card p-5">
          <h2 className="font-display text-xl font-semibold uppercase">Source</h2>
          {src ? (
            <p className="text-sm mt-2">{src.filename} · sheet {src.sheet} · {src.rangeStart} to {src.rangeEnd} · imported {src.importedAt}</p>
          ) : <p className="text-sm text-muted mt-2">No source imported yet. Events were added by hand.</p>}
          <ul className="flex flex-wrap gap-3 mt-3 text-sm">{counts.map(({ c, n }) => <li key={c.id} className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: c.color }} />{c.label}: <b>{n}</b></li>)}</ul>
        </section>
        <section className="card p-5">
          <h2 className="font-display text-xl font-semibold uppercase">Rules in force</h2>
          <ol className="list-decimal pl-5 text-sm grid gap-1.5 mt-2">
            <li>Every {catOf(settings.prep_category ?? "recre").label} delivery has a 🚩 {settings.prep_name}, {settings.prep_lead_days} working day{settings.prep_lead_days === 1 ? "" : "s"} before by default. It can anchor a move or move along with its episode.</li>
            <li>Every move shows a preview first. Clearing all categories or turning ripple off moves only the chosen event.</li>
            <li>Ripple moves, once each, the linked events of the same episode on the original date or later, in the chosen categories. Earlier events, other categories and other episodes stay put.</li>
            <li>Standalone events move alone and never move with others.</li>
            <li>Dates count working days only ({settings.working_days.map((d) => WD[d]).join(", ")}). The starting day is not counted, the destination is. New dates must be working days. There is no holiday calendar.</li>
            <li>Undo restores exactly the saved state of your latest change, only if nothing changed after it.</li>
            <li>Deleting a delivery hides its preparation; deleting only the preparation keeps the delivery. Feeds are read-only and can be revoked.</li>
          </ol>
        </section>
        <form action={saveCalendarSettings} className="card p-5 grid gap-4">
          <input type="hidden" name="project" value={pid} /><input type="hidden" name="back" value={here} />
          <h2 className="font-display text-xl font-semibold uppercase">Settings</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1"><span className="label">Calendar name</span><input name="name" defaultValue={settings.name} className="input" /></label>
            <fieldset><legend className="label mb-1">Working days</legend><div className="flex flex-wrap gap-2 text-sm">{WD.map((d, i) => <label key={d} className="inline-flex items-center gap-1"><input type="checkbox" name="wd" value={i} defaultChecked={settings.working_days.includes(i)} />{d}</label>)}</div></fieldset>
            <label className="grid gap-1"><span className="label">Category with a preparation deadline</span>
              <select name="prep_category" defaultValue={settings.prep_category ?? ""} className="input"><option value="">None</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <label className="grid gap-1"><span className="label">Days before</span><input type="number" name="lead" min={0} max={30} defaultValue={settings.prep_lead_days} className="input" /></label>
              <label className="grid gap-1"><span className="label">Preparation name</span><input name="prep_name" defaultValue={settings.prep_name} className="input" /></label>
            </div>
          </div>
          <div>
            <p className="label mb-1">Categories</p>
            <div className="grid gap-2">
              {cats.map((c) => (
                <div key={c.id} className="grid gap-2 items-center md:grid-cols-[48px_1fr_160px_1.4fr_auto]">
                  <input type="hidden" name="cat_id" value={c.id} />
                  <input type="color" name={`cat_color_${c.id}`} defaultValue={c.color} aria-label={`Colour of ${c.label}`} className="h-9 w-12 rounded" />
                  <input name={`cat_label_${c.id}`} defaultValue={c.label} className="input" aria-label="Name" />
                  <input name={`cat_short_${c.id}`} defaultValue={c.short} className="input" aria-label="Short name" />
                  <input name={`cat_desc_${c.id}`} defaultValue={c.description} className="input" aria-label="Description" />
                  <label className="text-xs inline-flex items-center gap-1"><input type="checkbox" name={`cat_remove_${c.id}`} /> Remove</label>
                </div>
              ))}
              <div className="grid gap-2 items-center md:grid-cols-[48px_1fr_1.4fr]">
                <input type="color" name="new_color" defaultValue="#777777" aria-label="Colour of the new category" className="h-9 w-12 rounded" />
                <input name="new_label" placeholder="New category" className="input" aria-label="New category" />
                <input name="new_desc" placeholder="Description" className="input" aria-label="Description of the new category" />
              </div>
            </div>
          </div>
          <label className="grid gap-1"><span className="label">Team rules (agreements in plain text)</span>
            <textarea name="team_rules" rows={5} defaultValue={source?.team_rules ?? ""} className="input" placeholder="Rules agreed with the team. A rule that should change dates by itself needs a change in the code: describe it to Claude." /></label>
          <SubmitButton className="btn justify-self-start">Save settings</SubmitButton>
        </form>
      </div>
    );
  }
}
