import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { fmtDay } from "@/lib/shots";
import { todayBRT } from "@/lib/checklist";
import { SubmitButton } from "@/components/submit-button";
import { addAvailability, deleteAvailability, saveAvailability, saveContact } from "./actions";

const KINDS: Record<string, string> = { "Full Time": "#5d9b6b", "Part Time": "#5b86c4", "Offline": "#c4646a", "Dr. Appointment": "#c09430", "School Adapt": "#9a74cc" };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();
const byName = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });

type CountRow = { project_id: string; project: string; episode_id: string; code: string; is_active: boolean; artist: string; account: boolean; active: boolean; n: number };
type Av = { id: string; person_id: string; kind: string; note: string; start_date: string; days: number };
type Person = { id: string; full_name: string; email: string; is_active: boolean; projects: string; phone: string | null; runway: string | null; portfolio: string | null };

export default async function ArtistManagement({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const tab = sp.tab === "availability" ? "availability" : "tracker";
  const showInactive = sp.inactive === "1";

  const data = await asUser(me.id, async (db) => ({
    counts: (await db.query<CountRow>(
      `select p.id as project_id, p.name as project, e.id as episode_id, e.code, e.is_active,
              coalesce(pr.full_name, s.artist_name) as artist, pr.id is not null as account, coalesce(pr.is_active, true) as active,
              count(*) filter (where not coalesce(st.not_a_shot, false))::int as n
         from tracker_shots s join episodes e on e.id = s.episode_id join projects p on p.id = s.project_id
         left join profiles pr on pr.id = s.artist_id left join statuses st on st.id = s.status_id
        where coalesce(pr.full_name, s.artist_name) is not null and not p.is_archived
        group by 1,2,3,4,5,6,7,8`)).rows,
    episodes: (await db.query<{ id: string; project_id: string; code: string; is_active: boolean }>(
      "select id, project_id, code, is_active from episodes order by code")).rows,
    people: (await db.query<Person>(
      `select pr.id, pr.full_name, pr.email, pr.is_active, c.phone, c.runway, c.portfolio,
              coalesce((select string_agg(p.name, ', ' order by p.name) from project_members m join projects p on p.id = m.project_id where m.user_id = pr.id), '') as projects
         from profiles pr left join artist_contacts c on c.person_id = pr.id where pr.user_type = 'artist'`)).rows.sort((a, b) => byName(a.full_name, b.full_name)),
    avail: (await db.query<Av>("select id, person_id, kind, note, to_char(start_date,'YYYY-MM-DD') as start_date, days from artist_availability")).rows,
  }));

  const head = (
    <>
      <h1 className="text-4xl font-bold">Artist Management</h1>
      <div className="flex gap-2 my-3" role="tablist">
        <Link role="tab" aria-selected={tab === "tracker"} href="/artists" className={`btn btn-sm ${tab === "tracker" ? "" : "btn-ghost"}`}>Artist Tracker</Link>
        <Link role="tab" aria-selected={tab === "availability"} href="/artists?tab=availability" className={`btn btn-sm ${tab === "availability" ? "" : "btn-ghost"}`}>Availability</Link>
      </div>
    </>
  );

  if (tab === "tracker") {
    const projects = [...new Map(data.counts.map((c) => [c.project_id, c.project])).entries()];
    return (
      <div className="max-w-[1400px]">
        {head}
        <p className="text-muted mb-3">How many shots each artist has in each episode. The numbers update by themselves from the Shot Trackers. Cancelled and Repeat shot / Alt do not count. Contacts are on the Availability tab.</p>
        <div className="flex flex-wrap gap-2 mb-4">
          <Link href="/admin/users" className="btn btn-ghost btn-sm">Add a new artist</Link>
          <Link href={showInactive ? "/artists" : "/artists?inactive=1"} className="btn btn-ghost btn-sm">{showInactive ? "Hide inactive artists" : "Show inactive artists"}</Link>
        </div>
        {projects.map(([pid, name]) => {
          const eps = data.episodes.filter((e) => e.project_id === pid);
          const rows = data.counts.filter((c) => c.project_id === pid && (c.active || showInactive));
          const artists = [...new Set(rows.map((r) => r.artist))].sort(byName);
          const n = (a: string, eid: string) => rows.filter((r) => r.artist === a && r.episode_id === eid).reduce((x, r) => x + r.n, 0);
          const colTot = eps.map((e) => artists.reduce((x, a) => x + n(a, e.id), 0));
          return (
            <section key={pid} className="card p-5 mb-4">
              <h2 className="font-display text-2xl font-semibold uppercase">{name}</h2>
              <div className="scroll mt-3">
                <table className="tracker">
                  <thead><tr><th>Artist</th>{eps.map((e) => <th key={e.id} className="text-right">{e.code}{!e.is_active && <span className="block text-[10px] font-normal">closed</span>}</th>)}<th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {artists.map((a) => {
                      const c = eps.map((e) => n(a, e.id)), t = c.reduce((x, y) => x + y, 0);
                      const acc = rows.find((r) => r.artist === a);
                      return (
                        <tr key={a} className={acc?.active === false ? "opacity-55" : ""}>
                          <td className="whitespace-nowrap"><b>{a}</b>{acc && !acc.account && <span className="text-xs text-muted"> (no account yet)</span>}{acc?.active === false && <span className="text-xs text-muted"> (inactive)</span>}</td>
                          {c.map((v, i) => <td key={i} className="text-right tabular-nums">{v || <span className="text-muted">0</span>}</td>)}
                          <td className="text-right font-bold tabular-nums">{t}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><th>Total</th>{colTot.map((v, i) => <th key={i} className="text-right">{v}</th>)}<th className="text-right">{colTot.reduce((x, y) => x + y, 0)}</th></tr></tfoot>
                </table>
              </div>
            </section>
          );
        })}
        {!projects.length && <div className="card p-8 text-center text-muted">No shots assigned yet.</div>}
      </div>
    );
  }

  // Availability: 3-week timeline from Monday, table, contacts
  const today = todayBRT();
  const week = Number(sp.week) || 0;
  const start = addDays(today, -((dow(today) + 6) % 7) + 7 * week);
  const days = Array.from({ length: 21 }, (_, i) => addDays(start, i));
  const on = (a: Av, d: string) => a.start_date <= d && d < addDays(a.start_date, Math.max(1, a.days));
  const active = data.people.filter((p) => p.is_active);
  const shotsOf = (name: string) => data.counts.filter((c) => c.artist === name && c.is_active).reduce((x, c) => x + c.n, 0);
  const nameOf = (id: string) => data.people.find((p) => p.id === id)?.full_name ?? "Unknown";
  const list = [...data.avail].sort((a, b) => byName(nameOf(a.person_id), nameOf(b.person_id)) || a.start_date.localeCompare(b.start_date));

  return (
    <div className="max-w-[1400px]">
      {head}
      <p className="text-muted mb-3">Who is working, part time or offline, day by day, in alphabetical order. The shot count next to each name comes from the active episodes.</p>
      <section className="card p-5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-display text-lg font-semibold">{fmtDay(days[0])} to {fmtDay(days[20])}</h2>
          <div className="flex gap-2">
            <Link className="btn btn-ghost btn-sm" href={`/artists?tab=availability&week=${week - 1}`} aria-label="Previous week">‹</Link>
            <Link className="btn btn-ghost btn-sm" href="/artists?tab=availability">This week</Link>
            <Link className="btn btn-ghost btn-sm" href={`/artists?tab=availability&week=${week + 1}`} aria-label="Next week">›</Link>
          </div>
        </div>
        <div className="scroll p-2">
          <div className="grid gap-1 text-xs min-w-[760px]" style={{ gridTemplateColumns: `200px repeat(21, minmax(18px, 1fr))` }}>
            <span />
            {days.map((d) => <span key={d} className={`text-center ${d === today ? "text-accent font-bold" : "text-muted"} ${[0, 6].includes(dow(d)) ? "opacity-50" : ""}`} title={fmtDay(d)}>{Number(d.slice(8))}</span>)}
            {active.map((p) => (
              <Row key={p.id} name={p.full_name} shots={shotsOf(p.full_name)} days={days} hits={(d) => {
                const hit = data.avail.filter((a) => a.person_id === p.id && on(a, d));
                return hit.find((a) => a.kind === "Offline") ?? hit[0];
              }} weekend={(d) => [0, 6].includes(dow(d))} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 mt-3 text-sm">{Object.entries(KINDS).map(([k, c]) => <span key={k} className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: c }} />{k}</span>)}</div>
      </section>

      <form action={addAvailability} className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <label className="grid gap-1"><span className="label">Person</span><select name="person" className="input !w-auto" required>{active.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
        <label className="grid gap-1"><span className="label">Availability</span><select name="kind" className="input !w-auto">{Object.keys(KINDS).map((k) => <option key={k}>{k}</option>)}</select></label>
        <label className="grid gap-1"><span className="label">Start</span><input type="date" name="start" defaultValue={today} className="input" required /></label>
        <label className="grid gap-1"><span className="label">Days</span><input type="number" name="days" defaultValue={5} min={0} max={366} className="input !w-20" /></label>
        <label className="grid gap-1 grow min-w-[180px]"><span className="label">Description</span><input name="note" className="input" placeholder="10 a.m - 7 p.m, vacation..." /></label>
        <SubmitButton className="btn">Add</SubmitButton>
      </form>

      <section className="card p-4 mb-4">
        <div className="scroll">
          <table className="tracker">
            <thead><tr><th>Person</th><th>Availability</th><th>Description</th><th>Start</th><th>Days</th><th></th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id}>
                  <td colSpan={6} className="!p-2">
                    <form action={saveAvailability} className="grid gap-2 items-center grid-cols-[minmax(160px,1fr)_150px_minmax(160px,1.4fr)_150px_80px_auto]">
                      <input type="hidden" name="id" value={a.id} />
                      <select name="person" defaultValue={a.person_id} className="input" aria-label="Person">{data.people.filter((p) => p.is_active || p.id === a.person_id).map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.is_active ? "" : " (inactive)"}</option>)}</select>
                      <select name="kind" defaultValue={a.kind} className="input" aria-label="Availability">{Object.keys(KINDS).map((k) => <option key={k}>{k}</option>)}</select>
                      <input name="note" defaultValue={a.note} className="input" aria-label="Description" />
                      <input type="date" name="start" defaultValue={a.start_date} className="input" aria-label="Start" />
                      <input type="number" name="days" defaultValue={a.days} min={0} max={366} className="input" aria-label="Days" />
                      <span className="flex gap-1"><SubmitButton className="btn btn-ghost btn-sm">Save</SubmitButton><SubmitButton formAction={deleteAvailability} className="btn btn-danger btn-sm">Remove</SubmitButton></span>
                    </form>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6} className="text-center text-muted py-6">No availability yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-display text-2xl font-semibold uppercase">Contacts</h2>
        <p className="text-sm text-muted mb-3">E-mail, phone, Runway account and portfolio of each artist. Only admins see this.</p>
        <div className="grid gap-2">
          {data.people.filter((p) => p.is_active || showInactive).map((p) => (
            <form key={p.id} action={saveContact} className={`grid gap-2 items-center md:grid-cols-[180px_200px_1fr_1fr_1fr_auto] border-b border-line pb-2 ${p.is_active ? "" : "opacity-55"}`}>
              <input type="hidden" name="person" value={p.id} />
              <span className="text-sm"><b>{p.full_name}</b><span className="block text-xs text-muted">{p.projects || "No projects"}</span></span>
              <span className="text-sm break-all">{p.email}</span>
              <input name="phone" defaultValue={p.phone ?? ""} placeholder="Phone" className="input" aria-label={`Phone of ${p.full_name}`} />
              <input name="runway" defaultValue={p.runway ?? ""} placeholder="Runway account" className="input" aria-label={`Runway account of ${p.full_name}`} />
              <input name="portfolio" defaultValue={p.portfolio ?? ""} placeholder="Portfolio link" className="input" aria-label={`Portfolio of ${p.full_name}`} />
              <SubmitButton className="btn btn-ghost btn-sm">Save</SubmitButton>
            </form>
          ))}
          {!data.people.length && <p className="text-sm text-muted">No artists with an account yet. Add them on People.</p>}
        </div>
      </section>
    </div>
  );
}

function Row({ name, shots, days, hits, weekend }: { name: string; shots: number; days: string[]; hits: (d: string) => Av | undefined; weekend: (d: string) => boolean }) {
  return (
    <>
      <span className="text-sm truncate"><b>{name}</b> <span className="text-xs text-muted">{shots} shot{shots === 1 ? "" : "s"}</span></span>
      {days.map((d) => {
        const k = hits(d);
        return <span key={d} className="h-5 rounded" title={k ? `${name} · ${k.kind}${k.note ? ` · ${k.note}` : ""} · ${fmtDay(d)}` : undefined}
          style={{ background: k ? KINDS[k.kind] ?? "#999" : weekend(d) ? "color-mix(in srgb, var(--ink) 3%, transparent)" : "color-mix(in srgb, var(--ink) 7%, transparent)" }} />;
      })}
    </>
  );
}
