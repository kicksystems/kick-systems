import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMe } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { fmtDay, fmtWhen } from "@/lib/shots";
import { todayBRT } from "@/lib/checklist";
import { CopyButton } from "@/components/copy-button";

const HOUR = 3600e3, DAY = 24 * HOUR;
const ISO = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const brt = (d: string, h: string) => Date.parse(`${d}T${h}:00-03:00`);
const hrs = (ms: number) => { const h = ms / HOUR; return h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)} days`; };
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

type Ep = { id: string; project_id: string; project: string; code: string; is_active: boolean; uses_episodes: boolean };
type ShotRow = { id: string; episode_id: string; artist: string | null; status_code: number | null; not_a_shot: boolean };
type Hist = { shot_id: string; to_code: number | null; t: number };

// Status codes as in the Coda numbering
const NS = 1, IP = 2, RFIA = 3, ADJ = 4, APP = 5, RFD = 6;
const SNAP: [string, string, number][] = [["🥳", "Shots Ready for Delivery", RFD], ["👍", "Shots Approved by Igor", APP], ["👀", "Shots Ready for Internal Approval", RFIA], ["🖌️", "Shots that Need Adjusments", ADJ], ["💻", "Shots In Progress", IP], ["⛔", "Shots Not Started", NS]];

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireMe();
  if (me.user_type !== "admin" && me.user_type !== "director") notFound();
  const sp = await searchParams;
  const tab = ["snap", "week", "rate", "saved"].includes(sp.tab) ? sp.tab : "snap";

  const data = await asUser(me.id, async (db) => {
    const eps = (await db.query<Ep>(
      `select e.id, e.project_id, p.name as project, e.code, e.is_active, p.uses_episodes
         from episodes e join projects p on p.id = e.project_id
        where public.can_manage_project(p.id) and not p.is_archived order by p.name, e.code`)).rows;
    const ids = eps.map((e) => e.id);
    const shots = ids.length ? (await db.query<ShotRow>(
      `select s.id, s.episode_id, coalesce(pr.full_name, s.artist_name) as artist, st.code as status_code, coalesce(st.not_a_shot, false) as not_a_shot
         from tracker_shots s left join profiles pr on pr.id = s.artist_id left join statuses st on st.id = s.status_id
        where s.episode_id = any($1)`, [ids])).rows : [];
    const hist = ids.length ? (await db.query<{ shot_id: string; to_code: number | null; at: string }>(
      `select h.shot_id, st.code as to_code, ${ISO("h.changed_at")} as at
         from tracker_status_history h join tracker_shots s on s.id = h.shot_id
         join statuses st on st.project_id = s.project_id and st.name = h.to_name
        where s.episode_id = any($1) order by h.changed_at, h.id`, [ids])).rows.map((h) => ({ shot_id: h.shot_id, to_code: h.to_code, t: Date.parse(h.at) })) : [];
    const saved = tab === "saved" ? (await db.query<{ id: string; project: string; kind: string; body: string; created_at: string; period_start: string | null; period_end: string | null }>(
      `select r.id, p.name as project, r.kind::text as kind, r.body, ${ISO("r.created_at")} as created_at,
              to_char(r.period_start,'YYYY-MM-DD') as period_start, to_char(r.period_end,'YYYY-MM-DD') as period_end
         from reports r join projects p on p.id = r.project_id order by r.created_at desc limit 60`).catch(() => ({ rows: [] }))).rows : [];
    return { eps, shots, hist, saved };
  });

  const byShot = new Map<string, Hist[]>();
  for (const h of data.hist) byShot.set(h.shot_id, [...(byShot.get(h.shot_id) ?? []), h]);
  const statusAt = (shot: string, t: number) => { let c: number | null = null; for (const h of byShot.get(shot) ?? []) if (h.t <= t) c = h.to_code; return c; };
  const title = (e: Ep) => `${e.project}${e.uses_episodes ? ` ${e.code}` : ""}`;
  const T = (k: string, t: string) => <Link href={`/reports?tab=${k}`} className={`btn btn-sm ${tab === k ? "" : "btn-ghost"}`}>{t}</Link>;

  let body: React.ReactNode = null;
  if (tab === "snap") {
    const active = data.eps.filter((e) => e.is_active);
    const focus = active.find((e) => e.id === sp.ep) ?? active[0];
    const today = todayBRT(), now = Date.now();
    const times: number[] = [];
    for (let i = 0; i < 4; i++) for (const h of ["22:00", "09:00"]) { const t = brt(addDays(today, -i), h); if (t <= now) times.push(t); }
    const shown = times.sort((a, b) => b - a).slice(0, 4);
    const text = (e: Ep, t: number) => {
      const sts = data.shots.filter((s) => s.episode_id === e.id).map((s) => statusAt(s.id, t));
      return `${title(e)}\n` + SNAP.map(([em, label, c]) => `${em} ${label}\n${sts.filter((x) => x === c).length}`).join("\n");
    };
    body = (
      <>
        <div className="flex flex-wrap gap-2 mb-3">{active.map((e) => <Link key={e.id} href={`/reports?tab=snap&ep=${e.id}`} className={`btn btn-sm ${focus?.id === e.id ? "" : "btn-ghost"}`}>{title(e)}</Link>)}</div>
        {focus ? (
          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {shown.map((t) => { const txt = text(focus, t); return (
              <section key={t} className="card p-4">
                <div className="flex items-center justify-between gap-2"><h3 className="font-display font-semibold">{fmtWhen(new Date(t).toISOString())}</h3><CopyButton text={txt} /></div>
                <pre className="whitespace-pre-wrap text-sm mt-2 font-sans">{txt}</pre>
              </section>); })}
          </div>
        ) : <p className="text-muted">No active episodes.</p>}
        <p className="text-xs text-muted mt-3">Status of each active episode at 9:00 and 22:00 (Brasília), rebuilt from the status history. History starts at the import of Nov 25, 2026.</p>
      </>
    );
  } else if (tab === "week") {
    const today = todayBRT();
    const off = Number(sp.week) || 0;
    const monday = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7) - 7 + 7 * off);
    const a = brt(monday, "00:00"), b = a + 7 * DAY;
    const artists = [...new Set(data.shots.map((s) => s.artist).filter(Boolean) as string[])];
    const rows = artists.map((art) => {
      const r = { art, del: 0, sub: 0, adj: 0, ipr: [] as number[], turn: [] as number[], ipapp: [] as number[] };
      for (const s of data.shots.filter((x) => x.artist === art)) {
        const hs = byShot.get(s.id) ?? [];
        hs.forEach((h, i) => {
          if (h.t < a || h.t >= b) return;
          const prev = hs.slice(0, i);
          if (h.to_code === RFD) r.del++;
          if (h.to_code === ADJ) r.adj++;
          if (h.to_code === RFIA) {
            r.sub++;
            const lastIP = [...prev].reverse().find((x) => x.to_code === IP); if (lastIP) r.ipr.push(h.t - lastIP.t);
            const lastADJ = [...prev].reverse().find((x) => x.to_code === ADJ); if (lastADJ) r.turn.push(h.t - lastADJ.t);
          }
          if (h.to_code === APP) { const firstIP = prev.find((x) => x.to_code === IP); if (firstIP && !prev.some((x) => x.to_code === APP)) r.ipapp.push(h.t - firstIP.t); }
        });
      }
      return r;
    }).filter((r) => r.del + r.sub + r.adj > 0).sort((x, y) => y.del - x.del || x.art.localeCompare(y.art));
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Link className="btn btn-ghost btn-sm" href={`/reports?tab=week&week=${off - 1}`}>‹ Previous week</Link>
          <b>{fmtDay(monday)} to {fmtDay(addDays(monday, 6))}</b>
          {off < 1 && <Link className="btn btn-ghost btn-sm" href={`/reports?tab=week&week=${off + 1}`}>Next week ›</Link>}
        </div>
        <div className="scroll"><table className="tracker">
          <thead><tr><th>Artist</th><th>Ready for Delivery</th><th>Sent for approval</th><th>Adjustments asked</th><th>In Progress → sent</th><th>Adjustment → resent</th><th>In Progress → Approved by Igor</th></tr></thead>
          <tbody>
            {rows.map((r) => { const f = (x: number[]) => { const v = avg(x); return v == null ? "–" : hrs(v); }; return (
              <tr key={r.art}><td><b>{r.art}</b></td><td>{r.del}</td><td>{r.sub}</td><td>{r.adj}</td><td>{f(r.ipr)}</td><td>{f(r.turn)}</td><td>{f(r.ipapp)}</td></tr>); })}
            {!rows.length && <tr><td colSpan={7} className="text-center text-muted py-6">No activity this week.</td></tr>}
          </tbody>
        </table></div>
        <p className="text-xs text-muted mt-3">Averages of the status changes inside the week. Monday to Sunday, Brasília time.</p>
      </>
    );
  } else if (tab === "rate") {
    const focus = data.eps.find((e) => e.id === sp.ep) ?? data.eps.find((e) => e.is_active) ?? data.eps[0];
    const list = focus ? data.shots.filter((s) => s.episode_id === focus.id && !s.not_a_shot && s.artist) : [];
    const arts = [...new Set(list.map((s) => s.artist as string))].map((art) => {
      const mine = list.filter((s) => s.artist === art);
      const adj = mine.reduce((n, s) => n + (byShot.get(s.id) ?? []).filter((h) => h.to_code === ADJ).length, 0) / mine.length;
      const times = mine.map((s) => { const hs = byShot.get(s.id) ?? []; const ip = hs.find((h) => h.to_code === IP), ap = hs.find((h) => h.to_code === APP); return ip && ap && ap.t > ip.t ? ap.t - ip.t : null; }).filter((x): x is number => x != null);
      return { art, n: mine.length, adj, speed: avg(times) };
    });
    const norm = (v: number, lo: number, hi: number, inv: boolean) => (hi === lo ? 1 : inv ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo));
    const A = arts.map((x) => x.adj), S = arts.map((x) => x.speed).filter((x): x is number => x != null), N = arts.map((x) => x.n);
    const rated = arts.map((x) => {
      const ss = x.speed == null ? 0 : norm(x.speed, Math.min(...S), Math.max(...S), true);
      const sq = norm(x.n, Math.min(...N), Math.max(...N), false);
      const sa = norm(x.adj, Math.min(...A), Math.max(...A), true);
      const score = 0.4 * ss + 0.3 * sq + 0.3 * sa;
      return { ...x, ss, sq, sa, stars: 1 + Math.round(score * 4) };
    }).sort((a, b) => b.stars - a.stars || a.art.localeCompare(b.art));
    body = (
      <>
        <form method="get" className="flex flex-wrap items-center gap-2 mb-3">
          <input type="hidden" name="tab" value="rate" />
          <select name="ep" defaultValue={focus?.id} className="input !w-auto" aria-label="Episode">{data.eps.map((e) => <option key={e.id} value={e.id}>{title(e)}{e.is_active ? " (in progress)" : " (closed)"}</option>)}</select>
          <button className="btn btn-ghost btn-sm">Show</button>
          {focus?.is_active && <span className="chip">Partial: episode still open</span>}
        </form>
        <div className="scroll"><table className="tracker">
          <thead><tr><th>Artist</th><th>Rating</th><th>Shots</th><th>Adjustments per shot</th><th>In Progress → Approved by Igor</th><th>Score parts</th></tr></thead>
          <tbody>
            {rated.map((r) => (
              <tr key={r.art}><td><b>{r.art}</b></td>
                <td className="whitespace-nowrap"><span className="text-[#c09430]" aria-label={`${r.stars} of 5`}>{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</span> {r.stars}</td>
                <td>{r.n}</td><td>{r.adj.toFixed(1)}</td><td>{r.speed == null ? "–" : hrs(r.speed)}</td>
                <td className="text-xs text-muted whitespace-nowrap">time {Math.round(r.ss * 100)} · qty {Math.round(r.sq * 100)} · adj {Math.round(r.sa * 100)}</td></tr>
            ))}
            {!rated.length && <tr><td colSpan={6} className="text-center text-muted py-6">No shots with an artist in this episode.</td></tr>}
          </tbody>
        </table></div>
        <p className="text-xs text-muted mt-3">1 to 5 stars, comparing the artists of the same episode, automatic only: 40% time per shot (In Progress → Approved by Igor), 30% number of shots, 30% adjustments per shot. Cancelled and Repeat shot / Alt are left out.</p>
      </>
    );
  } else {
    body = (
      <div className="grid gap-3">
        {data.saved.map((r) => (
          <section key={r.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><span><span className="chip">{r.project}</span> <b className="capitalize">{r.kind}</b> <span className="text-xs text-muted">{fmtWhen(r.created_at)}</span></span><CopyButton text={r.body} /></div>
            <pre className="whitespace-pre-wrap text-sm mt-2 font-sans">{r.body}</pre>
          </section>
        ))}
        {!data.saved.length && <div className="card p-8 text-center text-muted">The Fada robot has not saved any report yet.</div>}
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-4xl font-bold">Reports</h1>
      <p className="text-muted mt-1 mb-4">Only admins and the director see this page.</p>
      <div className="flex flex-wrap gap-2 mb-4">{T("snap", "Status at 9:00 and 22:00")}{T("week", "Weekly artist report")}{T("rate", "Episode ratings")}{T("saved", "Sent by the Fada robot")}</div>
      {body}
    </div>
  );
}
