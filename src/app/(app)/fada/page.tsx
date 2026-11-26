import { requireAdmin } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { fmtWhen } from "@/lib/shots";
import { Fairy } from "@/components/fairy";
import { SubmitButton } from "@/components/submit-button";
import { addReminder, deleteReminder } from "./actions";

const ISO = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export default async function FadaPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const data = await asUser(me.id, async (db) => {
    const projects = (await db.query<{ id: string; name: string }>("select id, name from projects where not is_archived order by name")).rows;
    const pid = projects.find((p) => p.id === sp.project)?.id ?? projects[0]?.id ?? null;
    const artists = pid ? (await db.query<{ id: string; full_name: string }>(
      `select pr.id, pr.full_name from profiles pr join project_members m on m.user_id = pr.id
        where m.project_id = $1 and pr.user_type = 'artist' and pr.is_active order by pr.full_name`, [pid])).rows : [];
    const list = (await db.query<{ id: string; body: string; project: string | null; to_name: string | null; by_name: string | null; created_at: string; expires_at: string | null }>(
      `select r.id, r.body, p.name as project, t.full_name as to_name, b.full_name as by_name,
              ${ISO("r.created_at")} as created_at, ${ISO("r.expires_at")} as expires_at
         from reminders r left join projects p on p.id = r.project_id
         left join profiles t on t.id = r.recipient_id left join profiles b on b.id = r.created_by
        where ($1::uuid is null or r.project_id = $1) order by r.created_at desc limit 100`, [sp.filter && /^[0-9a-f-]{36}$/.test(sp.filter) ? sp.filter : null])).rows;
    return { projects, pid, artists, list };
  });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-4 mb-2"><Fairy size={84} />
        <div><h1 className="text-4xl font-bold">Fada dos shots</h1><p className="text-muted">Reminders from Fernanda. Each one shows on the Home of the artists of that project.</p></div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2 mt-4 mb-2">
        <label className="grid gap-1"><span className="label">Project</span>
          <select name="project" defaultValue={data.pid ?? ""} className="input !w-auto">{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="btn btn-ghost btn-sm">Load artists</button>
      </form>
      <form action={addReminder} className="card p-5 grid gap-3 mb-6">
        <input type="hidden" name="project" value={data.pid ?? ""} />
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <label className="grid gap-1"><span className="label">To</span>
            <select name="to" className="input" defaultValue="">
              <option value="">All {data.projects.find((p) => p.id === data.pid)?.name ?? ""} artists</option>
              {data.artists.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select></label>
          <label className="grid gap-1"><span className="label">Shows for (days, 0 = until removed)</span>
            <input name="days" type="number" min={0} max={90} defaultValue={0} className="input" /></label>
        </div>
        <label className="grid gap-1"><span className="label">Reminder</span>
          <textarea name="body" required rows={3} className="input" placeholder="Ex.: Hugo, o 312 Shot050 vence quinta. Dá um carinho nele hoje!" /></label>
        <div><SubmitButton className="btn">Send reminder</SubmitButton></div>
      </form>

      <div className="flex flex-wrap gap-2 mb-3">
        <a href="/fada" className={`btn btn-sm ${sp.filter ? "btn-ghost" : ""}`}>All projects</a>
        {data.projects.map((p) => <a key={p.id} href={`/fada?filter=${p.id}`} className={`btn btn-sm ${sp.filter === p.id ? "" : "btn-ghost"}`}>{p.name}</a>)}
      </div>
      <div className="grid gap-3">
        {data.list.map((r) => (
          <div key={r.id} className="card p-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="chip">{r.project ?? "Every project"}</span> <b className="text-sm">{r.to_name ?? "All artists"}</b>
              <span className="text-xs text-muted"> · {fmtWhen(r.created_at)}{r.by_name ? ` · by ${r.by_name.split(" ")[0]}` : ""}{r.expires_at ? ` · until ${fmtWhen(r.expires_at)}` : ""}</span>
              <p className="mt-1">{r.body}</p>
            </div>
            <form action={deleteReminder}><input type="hidden" name="id" value={r.id} /><SubmitButton className="btn btn-danger btn-sm">Remove</SubmitButton></form>
          </div>
        ))}
        {!data.list.length && <div className="card p-8 text-center text-muted">No reminders yet.</div>}
      </div>
    </div>
  );
}
