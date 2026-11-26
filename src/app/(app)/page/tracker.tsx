import Link from "next/link";
import type { Me } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { Markdown } from "@/lib/md";
import {
  episodeCount, fmtDay, fmtShort, fmtWhen, progress, projectColumns, projectStatuses, statusChoices,
  type LastChange, type Note, type Shot, type Status,
} from "@/lib/shots";
import { addNote, addShot, deleteNote, saveClientNote } from "./actions";
import { StatusSelect } from "./status-select";

type PageInfo = { id: string; title: string; project_id: string; episode_id: string; project: string; uses_episodes: boolean; episode: string | null };
type Row = Shot & { artist_display?: string | null };

const ISO = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export async function TrackerView({ me, page, sp }: { me: Me; page: PageInfo; sp: Record<string, string> }) {
  const client = me.user_type === "client";
  const data = await asUser(me.id, async (db) => {
    const project = (await db.query("select * from projects where id=$1", [page.project_id])).rows[0];
    const episode = (await db.query("select id, code, title, is_active, storyline, header_md from episodes where id=$1", [page.episode_id])).rows[0];
    const manager = (await db.query("select public.can_manage_project($1) as ok", [page.project_id])).rows[0].ok as boolean;
    const statuses = await projectStatuses(db, page.project_id);
    const shots: Row[] = client
      ? (await db.query<Row>("select * from tracker_shots_client where episode_id=$1 order by sort_order, shot_num", [page.episode_id])).rows
      : (await db.query<Row>(
          `select s.*, to_char(s.due_date, 'YYYY-MM-DD') as due_date, coalesce(pr.full_name, s.artist_name) as artist_display
             from tracker_shots s left join profiles pr on pr.id = s.artist_id
            where s.episode_id=$1 order by s.sort_order, s.shot_num`, [page.episode_id])).rows;
    const ids = shots.map((x) => x.id);
    const notes: Note[] = client || !ids.length ? [] : (await db.query<Note>(
      `select id, shot_id, author_name, body, ${ISO("created_at")} as created_at from tracker_notes where shot_id = any($1) order by created_at`, [ids])).rows;
    const last: LastChange[] = client || !ids.length ? [] : (await db.query<LastChange>(
      `select distinct on (shot_id) shot_id, from_name, to_name, changed_by_name, ${ISO("changed_at")} as changed_at
         from tracker_status_history where shot_id = any($1) order by shot_id, changed_at desc, id desc`, [ids])).rows;
    return { project, episode, manager, statuses, shots, notes, last };
  });

  const { project, episode, manager, statuses, shots, notes, last } = data;
  const cols = projectColumns(project, me.user_type);
  const hasSlate = cols.some((c) => c.k === "slate");
  const count = episodeCount(shots, statuses, hasSlate);
  const pr = progress(shots, statuses);
  const here = `/page/${page.id}`;

  // Filters (kept in the address, so a filtered view can be shared)
  const f = { artist: sp.artist ?? "", status: sp.status ?? "", seq: sp.seq ?? "", q: (sp.q ?? "").toLowerCase(), mine: sp.mine === "1" };
  let list = shots;
  if (f.mine) list = list.filter((x) => x.artist_id === me.id);
  if (f.artist) list = list.filter((x) => (x.artist_display ?? "") === f.artist);
  if (f.status) list = list.filter((x) => x.status_id === f.status);
  if (f.seq) list = list.filter((x) => (x.sequence ?? "") === f.seq);
  if (f.q) list = list.filter((x) => `${x.shot_num} ${x.slate ?? ""} ${x.brief}`.toLowerCase().includes(f.q));
  const artists = [...new Set(shots.map((x) => x.artist_display).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const seqs = [...new Set(shots.map((x) => x.sequence).filter(Boolean) as string[])];
  const scenes = !page.uses_episodes ? [...(project.scenes as string[]), ...seqs.filter((q) => !(project.scenes as string[]).includes(q))] : [];

  const what = manager ? "You can edit every column. Internal notes are signed with your name and the date."
    : me.user_type === "artist" ? "You can move your own shots to Not Started, In Progress or Ready for Internal Approval."
    : client ? "You can write in Elves Notes and Showrunner Notes." : "Read only.";

  const statusOf = (id: string | null) => statuses.find((x) => x.id === id);

  const cell = (x: Row, k: string) => {
    switch (k) {
      case "shot_num": return (
        <td key={k} className="whitespace-nowrap font-bold">
          {x.shot_num || "–"}
          {manager && <><br /><Link href={`/shot/${x.id}?back=${encodeURIComponent(here)}`} className="text-xs font-semibold text-accent underline">Edit</Link></>}
        </td>);
      case "artist": return <td key={k} className="whitespace-nowrap">{x.artist_display || <span className="text-muted">No artist</span>}</td>;
      case "due_date": return <td key={k} className="whitespace-nowrap">{x.due_date ? fmtDay(x.due_date) : <span className="text-muted">–</span>}</td>;
      case "drive": return <td key={k}>{x.drive_url ? <a href={x.drive_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Drive</a> : <span className="text-muted">–</span>}</td>;
      case "status": return <td key={k}><StatusCell x={x} /></td>;
      case "brief": return <td key={k} className="brief text-sm">{x.brief}</td>;
      case "boards": return (
        <td key={k} className="min-w-[140px]">
          <div className="flex flex-wrap gap-1">
            {x.boards.slice(0, 3).map((b, i) => (
              <a key={i} href={b.url} target="_blank" rel="noreferrer" title={b.name ?? "Board"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.url} alt={b.name ?? `Board ${i + 1}`} loading="lazy" className="h-14 w-auto rounded-md border border-line bg-surface2" />
              </a>
            ))}
            {x.boards.length > 3 && <span className="text-xs text-muted self-end">+{x.boards.length - 3}</span>}
          </div>
        </td>);
      case "internal_notes": {
        const mine = notes.filter((n) => n.shot_id === x.id);
        return (
          <td key={k} className="note">
            {mine.map((n) => (
              <div key={n.id} className="mb-1">
                <b>({n.author_name}, {fmtShort(n.created_at)})</b> - {n.body}
                {manager && (
                  <form action={deleteNote} className="inline">
                    <input type="hidden" name="note" value={n.id} /><input type="hidden" name="back" value={here} />
                    <button className="ml-1 text-muted hover:text-danger" aria-label="Remove this note">×</button>
                  </form>
                )}
              </div>
            ))}
            {!mine.length && !manager && <span className="text-muted">–</span>}
            {manager && (
              <form action={addNote} className="mt-1">
                <input type="hidden" name="shot" value={x.id} /><input type="hidden" name="back" value={here} />
                <input name="body" className="input !min-h-[30px] text-xs" placeholder="Add a note, press Enter" aria-label={`Add an internal note to ${x.shot_num}`} />
              </form>
            )}
          </td>);
      }
      case "showrunner_notes": case "elves_notes": {
        const v = x[k as "showrunner_notes" | "elves_notes"];
        if (client || manager) return (
          <td key={k} className="note">
            <form action={saveClientNote} className="grid gap-1">
              <input type="hidden" name="shot" value={x.id} /><input type="hidden" name="field" value={k} /><input type="hidden" name="back" value={here} />
              <textarea name="body" defaultValue={v} rows={2} className="input text-xs" aria-label={`${k === "elves_notes" ? "Elves" : "Showrunner"} notes for ${x.shot_num}`} />
              <button className="btn btn-ghost btn-sm justify-self-start">Save</button>
            </form>
          </td>);
        return <td key={k} className="note">{v || <span className="text-muted">–</span>}</td>;
      }
      case "director_notes": return <td key={k} className="note">{x.director_notes || <span className="text-muted">–</span>}</td>;
      default: {
        const v = x[k as "act" | "sequence" | "slate" | "timecodes" | "duration"];
        return <td key={k} className="whitespace-nowrap text-sm">{v || <span className="text-muted">–</span>}</td>;
      }
    }
  };

  function StatusCell({ x }: { x: Row }) {
    const st = statusOf(x.status_id);
    const choices = statusChoices(x, statuses, me, manager);
    const lc = last.find((l) => l.shot_id === x.id);
    return (
      <div className="flex items-center gap-1.5">
        {choices.length
          ? <StatusSelect shot={x.id} current={x.status_id} options={choices} label={`Status of ${x.shot_num}`} />
          : st ? <span className="pill" style={{ ["--c" as string]: st.color }}>{st.name}</span> : <span className="text-muted">–</span>}
        {lc && (
          <span tabIndex={0} className="inline-grid place-items-center w-6 h-6 rounded-full border border-line text-[12px] font-bold text-muted cursor-help"
            title={`Last change: ${lc.from_name ? `${lc.from_name} → ` : ""}${lc.to_name ?? "no status"}, by ${lc.changed_by_name ?? "someone"}, ${fmtWhen(lc.changed_at)} (Brasília)`}
            aria-label="Last status change">i</span>
        )}
      </div>
    );
  }

  const rows = (items: Row[]) => items.map((x) => <tr key={x.id}>{cols.map((c) => cell(x, c.k))}</tr>);

  return (
    <div className="max-w-[1500px]">
      <p className="text-sm text-muted">{page.project}{page.uses_episodes ? ` · Episode ${episode.code}` : project.type_label ? ` · ${project.type_label}` : ""}{episode.is_active ? "" : " · closed"}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-bold">Shot Tracker</h1>
        {manager && (
          <form action={addShot} className="flex gap-2 items-center">
            <input type="hidden" name="episode" value={episode.id} /><input type="hidden" name="back" value={here} />
            <button className="btn">Add shot</button>
          </form>
        )}
      </div>
      <p className="text-muted mt-1 mb-4">{what}</p>

      <section className="callout grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] mb-4">
        <div>
          <h2 className="font-display text-xl font-semibold">{count.text}</h2>
          <p className="text-xs text-muted mt-0.5 mb-3">
            Counted automatically: {hasSlate ? "slates are the distinct SLATE numbers, " : ""}shots leave out {statuses.filter((x) => x.not_a_shot).map((x) => x.name).join(" and ") || "nothing"}{hasSlate ? ", and the duration takes one shot per slate" : ""}.
          </p>
          {episode.storyline && <><h3 className="font-display font-semibold">{page.uses_episodes ? "Storyline" : "About"}</h3><Markdown text={episode.storyline} className="text-sm" /></>}
          <div className="mt-3">
            <div className="flex justify-between text-sm"><span>{pr.done} of {pr.total} shots Ready for Delivery</span><b>{pr.pct}%</b></div>
            <div className="bar mt-1"><i style={{ width: `${pr.pct}%` }} /></div>
          </div>
        </div>
        <div className="text-sm">
          {episode.header_md ? <Markdown text={episode.header_md} /> : <p className="text-muted">Links for this episode (Premiere file, rough cut, recre list) appear here.</p>}
        </div>
      </section>

      <form className="flex flex-wrap gap-2 items-center my-3" method="get">
        {me.user_type === "artist" && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={f.mine} /> Only my shots</label>}
        {!client && (
          <select name="artist" defaultValue={f.artist} className="input !w-auto" aria-label="Filter by artist">
            <option value="">All artists</option>
            {artists.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <select name="status" defaultValue={f.status} className="input !w-auto" aria-label="Filter by status">
          <option value="">All statuses</option>
          {statuses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select name="seq" defaultValue={f.seq} className="input !w-auto" aria-label="Filter by sequence">
          <option value="">{page.uses_episodes ? "All sequences" : "All scenes"}</option>
          {seqs.map((q) => <option key={q} value={q}>{q}</option>)}
        </select>
        <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Search shot or brief" className="input !w-56" aria-label="Search shots" />
        <button className="btn btn-ghost btn-sm">Filter</button>
        {(f.artist || f.status || f.seq || f.q || f.mine) && <Link href={here} className="text-sm underline text-muted">Clear</Link>}
        <span className="text-sm text-muted ml-auto">{list.length} of {shots.length} rows</span>
      </form>

      <div className="scroll">
        <table className="tracker">
          <thead><tr>{cols.map((c) => <th key={c.k}>{c.t}</th>)}</tr></thead>
          <tbody>
            {!page.uses_episodes
              ? scenes.map((q) => {
                  const items = list.filter((x) => (x.sequence ?? "") === q);
                  if (!items.length && !manager) return null;
                  return [
                    <tr key={`scene-${q}`} className="scene"><td colSpan={cols.length}>
                      {q} <span className="text-xs text-muted font-normal">{items.length} shot{items.length === 1 ? "" : "s"}</span>
                      {manager && (
                        <form action={addShot} className="inline ml-2">
                          <input type="hidden" name="episode" value={episode.id} /><input type="hidden" name="sequence" value={q} /><input type="hidden" name="back" value={here} />
                          <button className="btn btn-ghost btn-sm">Add shot to this scene</button>
                        </form>
                      )}
                    </td></tr>,
                    ...rows(items),
                  ];
                })
              : rows(list)}
            {list.length === 0 && <tr><td colSpan={cols.length} className="text-center text-muted py-8">No shots match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type { Status };
