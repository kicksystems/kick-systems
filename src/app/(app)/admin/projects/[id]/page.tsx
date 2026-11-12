import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { PAGE_KINDS, PAGE_KIND_LABEL } from "@/lib/queries";
import {
  addEpisode, deletePage, deleteStatus, savePage, saveStatus, toggleEpisode, updateProject,
} from "../actions";

const VIEW_TYPES = ["artist", "client"] as const; // admins, directors and observers see pages automatically

type Status = { id: string; name: string; color: string; sort_order: number; is_initial: boolean; counts_as_done: boolean; allowed: string[] };
type PageRow = { id: string; title: string; kind: string; visible_to: string[]; sort_order: number };

export default async function ProjectSettings({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const data = await asUser(me.id, async (db) => {
    const project = (await db.query("select * from projects where id=$1", [id])).rows[0];
    if (!project) return null;
    return {
      project,
      episodes: (await db.query("select id, code, title, is_active from episodes where project_id=$1 order by code desc", [id])).rows,
      statuses: (await db.query<Status>(
        `select s.*, coalesce(array_agg(sp.user_type::text) filter (where sp.user_type is not null), '{}') as allowed
           from statuses s left join status_permissions sp on sp.status_id = s.id
          where s.project_id=$1 group by s.id order by s.sort_order`, [id])).rows,
      pages: (await db.query<PageRow>("select * from pages where project_id=$1 and episode_id is null order by sort_order, title", [id])).rows,
      templates: (await db.query<PageRow>("select * from episode_page_templates where project_id=$1 order by sort_order", [id])).rows,
      members: (await db.query(
        `select pr.full_name, pr.user_type from project_members m join profiles pr on pr.id=m.user_id
          where m.project_id=$1 order by pr.user_type, pr.full_name`, [id])).rows,
    };
  });
  if (!data) notFound();
  const { project, episodes, statuses, pages, templates, members } = data;
  const hid = (k: string, v: string) => <input type="hidden" name={k} value={v} />;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/admin/projects" className="text-sm text-muted hover:text-accent">← Projects</Link>
        <h1 className="font-display text-3xl font-bold">{project.name}</h1>
        {sp.saved && <p className="text-sm text-ok mt-1">Saved.</p>}
      </div>

      <Section title="About">
        <form action={updateProject} className="grid gap-3 sm:grid-cols-2">
          {hid("id", project.id)}
          <label><span className="label">Name</span><input className="input mt-1" name="name" defaultValue={project.name} required /></label>
          <label><span className="label">Description</span><input className="input mt-1" name="description" defaultValue={project.description ?? ""} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="uses_episodes" defaultChecked={project.uses_episodes} /> Organised by episodes</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_archived" defaultChecked={project.is_archived} /> Archived (hidden from the menu)</label>
          <div><button className="btn">Save</button></div>
        </form>
      </Section>

      <Section title="Episodes" hint="Closing an episode keeps it forever; it just leaves the active list and the reports.">
        <ul className="divide-y divide-line mb-4">
          {episodes.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-semibold w-28">Episode {e.code}</span>
              <span className={`chip ${e.is_active ? "" : "!bg-line !text-muted"}`}>{e.is_active ? "active" : "closed"}</span>
              <form action={toggleEpisode} className="ml-auto">
                {hid("id", e.id)}{hid("project_id", id)}
                <button className="btn btn-ghost">{e.is_active ? "Close" : "Reopen"}</button>
              </form>
            </li>
          ))}
          {episodes.length === 0 && <li className="py-2 text-sm text-muted">No episodes yet.</li>}
        </ul>
        <form action={addEpisode} className="flex flex-wrap gap-2 items-end">
          {hid("project_id", id)}
          <label className="flex flex-col"><span className="label">Episode number</span><input className="input mt-1 w-32" name="code" required /></label>
          <label className="grow flex flex-col"><span className="label">Title (optional)</span><input className="input mt-1" name="title" /></label>
          <button className="btn">Add episode</button>
        </form>
        <p className="text-xs text-muted mt-2">A new episode gets the pages listed under “Pages of each episode”.</p>
      </Section>

      <Section title="Workflow" hint="Admins and directors can set any status. Tick who else may move a shot into each status.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-left text-xs text-muted uppercase tracking-wide">
              <th className="py-1 pr-2">#</th><th className="pr-2">Status</th><th className="pr-2">Color</th>
              <th className="pr-2">Who else can set it</th><th className="pr-2">Counts as done</th><th className="pr-2">Starts here</th><th></th>
            </tr></thead>
            <tbody>
              {[...statuses, null].map((st) => (
                <tr key={st?.id ?? "new"} className="border-t border-line align-middle">
                  <td colSpan={7} className="py-2">
                    <form action={saveStatus} className="grid grid-cols-[64px_1fr_56px_180px_90px_80px_170px] gap-2 items-center">
                      {hid("project_id", id)}{hid("id", st?.id ?? "")}
                      <input className="input" name="sort_order" type="number" defaultValue={st?.sort_order} aria-label="Order" />
                      <input className="input" name="name" defaultValue={st?.name} placeholder={st ? undefined : "New status"} required aria-label="Status name" />
                      <input type="color" name="color" defaultValue={st?.color ?? "#9ca3af"} aria-label="Color" className="h-8 w-12 rounded" />
                      <span className="flex gap-3">
                        {(["artist", "client"] as const).map((t) => (
                          <label key={t} className="flex items-center gap-1 capitalize">
                            <input type="checkbox" name="allowed" value={t} defaultChecked={st?.allowed.includes(t)} />{t}
                          </label>
                        ))}
                      </span>
                      <label className="flex justify-center"><input type="checkbox" name="counts_as_done" defaultChecked={st?.counts_as_done} aria-label="Counts as done" /></label>
                      <label className="flex justify-center"><input type="radio" name="is_initial" defaultChecked={st?.is_initial} aria-label="New shots start here" /></label>
                      <span className="flex gap-2 justify-end">
                        <button className="btn btn-ghost">{st ? "Save" : "Add"}</button>
                        {st && !st.is_initial && (
                          <button formAction={deleteStatus} className="btn btn-danger" aria-label={`Remove ${st.name}`}>Remove</button>
                        )}
                      </span>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-2">“Counts as done” feeds the progress bar. In PEKS that is Ready for Delivery.</p>
      </Section>

      <Section title="Project pages" hint="Pages that belong to the whole project (training, templates, guidelines…).">
        <PageList rows={pages} scope="page" projectId={id} />
      </Section>

      <Section title="Pages of each episode" hint="Every new episode is created with these pages.">
        <PageList rows={templates} scope="template" projectId={id} />
      </Section>

      <Section title="People" hint="Add or remove people on the People page.">
        <ul className="flex flex-wrap gap-2 text-sm">
          {members.map((m) => <li key={m.full_name} className="chip !bg-bg !text-ink border border-line">{m.full_name} · {m.user_type}</li>)}
        </ul>
        <Link href="/admin/users" className="text-sm underline mt-3 inline-block hover:text-accent">Manage people</Link>
      </Section>
    </div>
  );

  function PageList({ rows, scope, projectId }: { rows: PageRow[]; scope: "page" | "template"; projectId: string }) {
    return (
      <div className="space-y-2">
        {[...rows, null].map((r) => (
          <form key={r?.id ?? "new"} action={savePage} className="grid gap-2 items-center sm:grid-cols-[56px_1fr_180px_auto_auto] border-t border-line pt-2 first:border-0 first:pt-0">
            {hid("project_id", projectId)}{hid("scope", scope)}{hid("id", r?.id ?? "")}
            <input className="input" name="sort_order" type="number" defaultValue={r?.sort_order ?? rows.length + 1} aria-label="Order" />
            <input className="input" name="title" defaultValue={r?.title} placeholder={r ? undefined : "New page title"} required aria-label="Title" />
            <select className="input" name="kind" defaultValue={r?.kind ?? "doc"} aria-label="Page type">
              {PAGE_KINDS.map((k) => <option key={k} value={k}>{PAGE_KIND_LABEL[k]}</option>)}
            </select>
            <span className="flex gap-3 text-sm">
              {VIEW_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1 capitalize">
                  <input type="checkbox" name="visible_to" value={t} defaultChecked={r?.visible_to.includes(t)} />{t}s
                </label>
              ))}
            </span>
            <span className="flex gap-2">
              <button className="btn btn-ghost">{r ? "Save" : "Add"}</button>
              {r && <button formAction={deletePage} className="btn btn-danger" aria-label={`Remove ${r.title}`}>Remove</button>}
            </span>
          </form>
        ))}
        <p className="text-xs text-muted">Admins, directors and observers see every page automatically (observers never see Reports). To show one page to one client only, use a page grant (coming with the page editor).</p>
      </div>
    );
  }
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-bold text-lg">{title}</h2>
      {hint && <p className="text-sm text-muted mb-4">{hint}</p>}
      {children}
    </section>
  );
}
