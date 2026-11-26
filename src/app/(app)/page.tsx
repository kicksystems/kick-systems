import Link from "next/link";
import { requireMe } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { navFor } from "@/lib/queries";
import { fmtDay, fmtWhen, projectStatuses, statusChoices, type Shot, type Status } from "@/lib/shots";
import { phraseOfTheDay, todayBRT, type Rule } from "@/lib/checklist";
import { WorldClock } from "@/components/world-clock";
import { Fairy } from "@/components/fairy";
import { StatusSelect } from "./page/status-select";
import { loadRows, loadSettings } from "@/lib/cal/data";
import { visibleEvents } from "@/lib/cal/model";

const ISO = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const longDate = () => new Date().toLocaleDateString("en-US", { timeZone: "America/Sao_Paulo", weekday: "long", month: "long", day: "numeric", year: "numeric" });

type Reminder = { id: string; body: string; project: string | null; recipient_id: string | null; created_at: string };

export default async function Home() {
  const me = await requireMe();
  const projects = await navFor(me.id);
  const first = me.full_name.split(" ")[0];
  const reminders = await asUser(me.id, async (db) => (await db.query<Reminder>(
    `select r.id, r.body, p.name as project, r.recipient_id, ${ISO("r.created_at")} as created_at
       from reminders r left join projects p on p.id = r.project_id
      where (r.expires_at is null or r.expires_at > now()) and (r.recipient_id is null or r.recipient_id = $1)
      order by r.created_at desc limit 5`, [me.id])).rows).catch(() => [] as Reminder[]);

  if (me.user_type === "artist") return <ArtistHome me={me} first={first} projects={projects} reminders={reminders} />;
  if (me.user_type === "client") return <ClientHome first={first} projects={projects} />;

  // Admins, the director and observers
  const manager = me.user_type === "admin" || me.user_type === "director";
  const active = projects.flatMap((p) => p.episodes.filter((e) => e.is_active).map((e) => ({ p, e })));
  return (
    <div className="max-w-6xl">
      <h1 className="text-4xl font-bold">Welcome back, {first}</h1>
      {me.user_type === "admin" ? <WorldClock /> : <p className="text-muted mt-1 mb-4">{longDate()}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] mb-5">
        <section className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl font-semibold">Active episodes</h2>
            <span className="text-xs text-muted">Ready for Delivery progress</span>
          </div>
          <ul className="mt-3 space-y-3">
            {active.map(({ p, e }) => {
              const tracker = e.pages.find((pg) => pg.kind === "shot_tracker");
              const guide = e.pages.find((pg) => pg.kind === "visual_guide");
              return (
                <li key={e.id} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <b>{p.name} {p.uses_episodes ? e.code : ""}</b>{e.title && <span className="text-muted">{e.title}</span>}
                    <span className="ml-auto flex gap-2">
                      {tracker && <Link className="btn btn-ghost btn-sm" href={`/page/${tracker.id}`}>Shot Tracker</Link>}
                      {guide && <Link className="btn btn-ghost btn-sm" href={`/page/${guide.id}`}>Visual Guides</Link>}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs"><div className="bar grow"><i style={{ width: `${e.pct}%` }} /></div><span className="whitespace-nowrap">{e.done} of {e.total} · <b>{e.pct}%</b></span></div>
                </li>
              );
            })}
            {!active.length && <li className="text-sm text-muted">No active episodes.</li>}
          </ul>
        </section>

        <div className="grid gap-4 content-start">
          {manager ? (
            <section className="card p-5">
              <h2 className="font-display text-xl font-semibold">Reports</h2>
              <p className="text-sm text-muted mb-3">Status at 9:00 and 22:00, weekly artist report and episode ratings.</p>
              <Link href="/reports" className="btn btn-sm">Open Reports</Link>
            </section>
          ) : (
            <section className="card p-5">
              <h2 className="font-display text-xl font-semibold">Read-only access</h2>
              <p className="text-sm text-muted">You see every page of your projects except Reports, and edit nothing.</p>
            </section>
          )}
          <section className="card p-5 flex gap-3">
            <Fairy size={56} />
            <div className="min-w-0">
              <h2 className="font-display text-xl font-semibold">Fada dos shots</h2>
              {reminders.slice(0, 2).map((r) => <p key={r.id} className="text-sm mt-1">{r.body}<br /><span className="text-xs text-muted">{r.project ?? "Every project"} · {fmtWhen(r.created_at)}</span></p>)}
              {!reminders.length && <p className="text-sm text-muted">No reminders right now.</p>}
              {me.user_type === "admin" && <Link href="/fada" className="text-sm underline text-accent mt-2 inline-block">Write a reminder</Link>}
            </div>
          </section>
          <CalendarCard me={me} />
        </div>
      </div>
    </div>
  );
}

async function ArtistHome({ me, first, projects, reminders }: {
  me: Awaited<ReturnType<typeof requireMe>>; first: string; projects: Awaited<ReturnType<typeof navFor>>; reminders: Reminder[];
}) {
  const data = await asUser(me.id, async (db) => {
    const shots = (await db.query<Shot & { project_id: string; episode_id: string }>(
      `select s.*, to_char(s.due_date,'YYYY-MM-DD') as due_date from tracker_shots s join episodes e on e.id = s.episode_id
        where s.artist_id = $1 and e.is_active order by s.episode_id, s.sort_order`, [me.id])).rows;
    const statuses: Record<string, Status[]> = {};
    for (const pid of [...new Set(shots.map((s) => s.project_id))]) statuses[pid] = await projectStatuses(db, pid);
    const rules = (await db.query<Rule>("select id, project_id, rule, phrases from checklist_rules order by sort_order, created_at")).rows;
    return { shots, statuses, rules };
  });
  const today = todayBRT();
  const groups = projects.flatMap((p) => p.episodes.filter((e) => e.is_active).map((e) => ({ p, e, mine: data.shots.filter((s) => s.episode_id === e.id) }))).filter((g) => g.mine.length);
  const page = (title: RegExp) => projects.flatMap((p) => p.pages).find((pg) => title.test(pg.title));
  const tutorials = page(/treinamento|tutorial|think like/i), prompts = page(/prompt/i);

  return (
    <div className="max-w-6xl">
      <h1 className="text-4xl font-bold">Welcome back, {first}</h1>
      <p className="text-muted mt-1 mb-5">Your shots on every project you are on. {longDate()}</p>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid gap-4 content-start">
          {groups.map(({ p, e, mine }) => {
            const st = data.statuses[p.id] ?? [];
            const done = mine.filter((s) => st.find((x) => x.id === s.status_id)?.counts_as_done).length;
            const pct = Math.round((done * 100) / mine.length);
            const tracker = e.pages.find((pg) => pg.kind === "shot_tracker");
            return (
              <section key={e.id} className="card p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-xl font-semibold">{p.name} {p.uses_episodes ? e.code : ""}</h2>
                  {tracker && <Link className="btn btn-ghost btn-sm" href={`/page/${tracker.id}?mine=1`}>Open Shot Tracker</Link>}
                </div>
                <div className="flex items-center gap-3 text-xs my-3"><div className="bar grow"><i style={{ width: `${pct}%` }} /></div><span className="whitespace-nowrap">{done} of {mine.length} of your shots Ready for Delivery</span></div>
                <div className="scroll">
                  <table className="tracker">
                    <thead><tr><th>Shot</th><th>Status</th><th>Drive</th><th>Due date</th></tr></thead>
                    <tbody>
                      {mine.map((s) => {
                        const choices = statusChoices(s, st, me, false);
                        const cur = st.find((x) => x.id === s.status_id);
                        const late = s.due_date && s.due_date < today && !cur?.counts_as_done;
                        return (
                          <tr key={s.id}>
                            <td className="font-bold whitespace-nowrap">{s.shot_num || "–"}</td>
                            <td>{choices.length ? <StatusSelect shot={s.id} current={s.status_id} options={choices} label={`Status of ${s.shot_num}`} />
                              : cur ? <span className="pill" style={{ ["--c" as string]: cur.color }}>{cur.name}</span> : "–"}</td>
                            <td>{s.drive_url ? <a className="btn btn-ghost btn-sm" href={s.drive_url} target="_blank" rel="noreferrer">Drive</a> : <span className="text-muted">–</span>}</td>
                            <td className={`whitespace-nowrap ${late ? "text-danger font-semibold" : ""}`}>{s.due_date ? fmtDay(s.due_date) : "–"}{late ? " · late" : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
          {!groups.length && <div className="card p-8 text-center text-muted">No shots assigned to you in active episodes.</div>}
        </div>

        <div className="grid gap-4 content-start">
          <section className="card p-5 flex gap-3">
            <Fairy size={72} />
            <div className="min-w-0">
              <h2 className="font-display text-xl font-semibold">Fada dos shots</h2>
              {reminders.slice(0, 3).map((r) => (
                <p key={r.id} className="text-sm mt-2">{r.body}<br />
                  <span className="text-xs text-muted">{r.project ? `${r.project} · ` : ""}{r.recipient_id ? "Just for you" : "To everyone"} · {fmtWhen(r.created_at)}</span></p>
              ))}
              {!reminders.length && <p className="text-sm text-muted mt-1">Nenhum lembrete. Tudo em dia!</p>}
            </div>
          </section>
          {tutorials && <Shortcut href={`/page/${tutorials.id}`} title="Tutorials" text="Training videos and how-tos" icon="play" />}
          {prompts && <Shortcut href={`/page/${prompts.id}`} title="Prompt Template" text="Templates for assets and style frames" icon="doc" />}
          {projects.map((p) => {
            const d = phraseOfTheDay(data.rules, me.id, p.id);
            if (!d) return null;
            return (
              <section key={p.id} className="card p-5">
                <div className="flex items-center justify-between gap-2"><h2 className="font-display text-xl font-semibold">{p.name} checklist</h2><span className="chip">Frase do dia</span></div>
                <p className="font-display text-lg leading-snug my-3">“{d.phrase}”</p>
                <p className="text-xs text-muted mb-3">Regra: {d.rule.rule}</p>
                <Link href={`/checklists?project=${p.id}`} className="btn btn-ghost btn-sm">Open full checklist ({d.total} rules)</Link>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Shortcut({ href, title, text, icon }: { href: string; title: string; text: string; icon: "play" | "doc" }) {
  return (
    <Link href={href} className="card p-4 flex items-center gap-3 hover:border-accent transition-colors">
      <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="12" fill="var(--accent-soft)" />
        {icon === "play" ? <path d="M18 15l16 9-16 9z" fill="var(--accent)" /> : <path d="M15 14h18v20H15zM19 20h10M19 25h10M19 30h6" fill="none" stroke="var(--accent)" strokeWidth="2" />}
      </svg>
      <span><b className="font-display text-lg">{title}</b><br /><span className="text-sm text-muted">{text}</span></span>
    </Link>
  );
}

async function ClientHome({ first, projects }: { first: string; projects: Awaited<ReturnType<typeof navFor>> }) {
  const active = projects.flatMap((p) => p.episodes.filter((e) => e.is_active).map((e) => ({ p, e })));
  return (
    <div className="max-w-6xl">
      <h1 className="text-4xl font-bold">Welcome, {first}</h1>
      <p className="text-muted mt-1 mb-5">Active episodes you follow. In the Shot Tracker you can write in Elves Notes and Showrunner Notes.</p>
      <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
        {active.map(({ p, e }) => (
          <section key={e.id} className="card p-5">
            <h2 className="font-display text-xl font-semibold">{p.name} {p.uses_episodes ? e.code : ""}</h2>
            <div className="flex items-center gap-3 text-xs my-3"><div className="bar grow"><i style={{ width: `${e.pct}%` }} /></div><span>{e.done} of {e.total}</span></div>
            <div className="flex flex-wrap gap-2">{e.pages.map((pg) => <Link key={pg.id} className="btn btn-ghost btn-sm" href={`/page/${pg.id}`}>{pg.title}</Link>)}</div>
          </section>
        ))}
        {!active.length && <div className="card p-8 text-center text-muted">No episodes shared with you yet.</div>}
      </div>
    </div>
  );
}


async function CalendarCard({ me }: { me: Awaited<ReturnType<typeof requireMe>> }) {
  const today = todayBRT();
  const data = await asUser(me.id, async (db) => {
    const p = (await db.query<{ id: string; name: string }>(
      "select id, name from projects where not is_archived and public.can_view_calendar(id) order by (name ilike '%peks%') desc, name limit 1")).rows[0];
    if (!p) return null;
    const settings = await loadSettings(db, p.id);
    const events = visibleEvents(await loadRows(db, p.id), settings).filter((e) => e.date >= today);
    return { p, settings, events };
  }).catch(() => null);
  if (!data) return null;
  const days = [...new Set(data.events.map((e) => e.date))].slice(0, 5);
  const color = (id: string) => data.settings.categories.find((c) => c.id === id)?.color ?? "#999";
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-2"><h2 className="font-display text-xl font-semibold">Calendar · {data.p.name}</h2><Link href="/calendar" className="btn btn-ghost btn-sm">Open</Link></div>
      <ul className="mt-2 grid gap-2 text-sm">
        {days.map((d) => (
          <li key={d}>
            <b className={d === today ? "text-accent" : ""}>{d === today ? "Today" : fmtDay(d)}</b>
            {data.events.filter((e) => e.date === d).slice(0, 4).map((e) => (
              <span key={e.id} className="flex items-center gap-1.5 text-xs mt-0.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: color(e.category) }} />{e.episode} {e.label}</span>
            ))}
          </li>
        ))}
        {!days.length && <li className="text-muted">No upcoming dates.</li>}
      </ul>
    </section>
  );
}
