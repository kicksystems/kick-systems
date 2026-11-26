import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { createProject } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function ProjectsPage() {
  const me = await requireAdmin();
  const projects = await asUser(me.id, async (db) => (await db.query(
    `select p.id, p.name, p.is_archived, src.name as copied_from,
            (select count(*) from episodes e where e.project_id = p.id)::int as episodes,
            (select count(*) from project_members m where m.project_id = p.id)::int as members
       from projects p left join projects src on src.id = p.copied_from order by p.is_archived, p.name`)).rows);

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl font-bold">Projects</h1>
      <p className="text-muted mb-5">Each project has its own pages, workflow and people.</p>

      <form action={createProject} className="card p-5 mb-6 grid gap-3 sm:grid-cols-2">
        <p className="sm:col-span-2 font-semibold">New project</p>
        <label><span className="label">Name</span><input className="input mt-1" name="name" required /></label>
        <label><span className="label">Start from</span>
          <select className="input mt-1" name="copy_from" defaultValue="">
            <option value="">Blank project</option>
            {projects.filter((p) => !p.is_archived).map((p) => <option key={p.id} value={p.id}>Copy structure of {p.name}</option>)}
          </select>
        </label>
        <label className="sm:col-span-2"><span className="label">Description (blank projects)</span><input className="input mt-1" name="description" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="uses_episodes" defaultChecked /> Organised by episodes</label>
        <p className="text-xs text-muted sm:col-span-2">Copying brings the workflow, the pages and their content. It does not bring episodes, shots or people.</p>
        <div><SubmitButton className="btn">Create project</SubmitButton></div>
      </form>

      <ul className="card divide-y divide-line">
        {projects.map((p) => (
          <li key={p.id}>
            <Link href={`/admin/projects/${p.id}`} className="flex flex-wrap items-center gap-3 p-4 hover:bg-bg">
              <span className={`font-semibold ${p.is_archived ? "text-muted line-through" : ""}`}>{p.name}</span>
              {p.copied_from && <span className="text-xs text-muted">copied from {p.copied_from}</span>}
              <span className="text-xs text-muted ml-auto">{p.episodes} episodes · {p.members} people</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
