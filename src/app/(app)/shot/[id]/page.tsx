import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMe } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { projectStatuses, fmtWhen } from "@/lib/shots";
import { deleteShot, saveShot } from "../../page/actions";
import { SubmitButton } from "@/components/submit-button";

export default async function EditShot({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireMe();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const back = sp.back?.startsWith("/") && !sp.back.startsWith("//") ? sp.back : "/";

  const data = await asUser(me.id, async (db) => {
    const shot = (await db.query(
      `select s.*, to_char(s.due_date,'YYYY-MM-DD') as due_date, e.code as episode, p.name as project, p.uses_episodes,
              public.can_manage_project(s.project_id) as manager
         from tracker_shots s join episodes e on e.id = s.episode_id join projects p on p.id = s.project_id where s.id=$1`, [id])).rows[0];
    if (!shot) return null;
    const statuses = await projectStatuses(db, shot.project_id);
    const artists = (await db.query(
      `select pr.id, pr.full_name, pr.is_active from profiles pr join project_members m on m.user_id = pr.id
        where m.project_id = $1 and pr.user_type = 'artist' and (pr.is_active or pr.id = $2) order by pr.full_name`,
      [shot.project_id, shot.artist_id])).rows as { id: string; full_name: string; is_active: boolean }[];
    const history = (await db.query(
      `select from_name, to_name, changed_by_name, to_char(changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as changed_at
         from tracker_status_history where shot_id=$1 order by changed_at desc, id desc limit 30`, [id])).rows;
    return { shot, statuses, artists, history };
  });
  if (!data || !data.shot.manager) notFound();
  const { shot, statuses, artists, history } = data;

  const field = (name: string, label: string, value: string | null, props: Record<string, unknown> = {}) => (
    <label className="grid gap-1"><span className="label">{label}</span><input className="input" name={name} defaultValue={value ?? ""} {...props} /></label>
  );
  const area = (name: string, label: string, value: string | null, rows = 3) => (
    <label className="grid gap-1 sm:col-span-2"><span className="label">{label}</span><textarea className="input" name={name} rows={rows} defaultValue={value ?? ""} /></label>
  );

  return (
    <div className="max-w-4xl">
      <Link href={back} className="text-sm text-muted hover:text-accent">← Shot Tracker</Link>
      <p className="text-sm text-muted mt-2">{shot.project}{shot.uses_episodes ? ` · Episode ${shot.episode}` : ""}</p>
      <h1 className="text-3xl font-bold mb-4">Edit {shot.shot_num || "shot"}</h1>

      <form action={saveShot} className="card p-5 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={shot.id} /><input type="hidden" name="back" value={back} />
        {field("shot_num", "Shot #", shot.shot_num, { required: true })}
        <label className="grid gap-1"><span className="label">Status</span>
          <select className="input" name="status_id" defaultValue={shot.status_id ?? ""}>
            {!shot.status_id && <option value="">No status</option>}
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {field("act", "Act", shot.act)}
        {field("sequence", shot.uses_episodes ? "Sequence" : "Scene", shot.sequence)}
        {field("slate", "Slate", shot.slate)}
        {field("timecodes", "Timecodes", shot.timecodes)}
        {field("duration", "Duration (e.g. 4s or 0:04)", shot.duration)}
        {field("due_date", "Due date", shot.due_date, { type: "date" })}
        <label className="grid gap-1"><span className="label">Artist</span>
          <select className="input" name="artist_id" defaultValue={shot.artist_id ?? ""}>
            <option value="">{shot.artist_name && !shot.artist_id ? `${shot.artist_name} (no account yet)` : "No artist"}</option>
            {artists.map((a) => <option key={a.id} value={a.id}>{a.full_name}{a.is_active ? "" : " (inactive)"}</option>)}
          </select>
        </label>
        {field("drive_url", "Drive folder link", shot.drive_url, { type: "url", placeholder: "https://drive.google.com/..." })}
        {area("brief", "Brief", shot.brief, 5)}
        {area("director_notes", "Director notes", shot.director_notes)}
        {area("showrunner_notes", "Showrunner Notes", shot.showrunner_notes)}
        {area("elves_notes", "Elves Notes", shot.elves_notes)}
        <div className="sm:col-span-2 flex flex-wrap gap-2 justify-between">
          <SubmitButton className="btn">Save shot</SubmitButton>
          <SubmitButton formAction={deleteShot} className="btn btn-danger">Delete shot</SubmitButton>
        </div>
      </form>

      <section className="card p-5 mt-5">
        <h2 className="font-display text-lg font-semibold">Status history</h2>
        <ul className="text-sm mt-2 space-y-1">
          {history.map((h, i) => (
            <li key={i}><span className="text-muted">{fmtWhen(h.changed_at)}</span> · {h.from_name ? `${h.from_name} → ` : ""}<b>{h.to_name ?? "no status"}</b> · {h.changed_by_name}</li>
          ))}
          {!history.length && <li className="text-muted">No changes yet.</li>}
        </ul>
      </section>
    </div>
  );
}
