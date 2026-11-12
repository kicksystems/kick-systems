import { notFound } from "next/navigation";
import { requireMe } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { PAGE_KIND_LABEL } from "@/lib/queries";

export default async function PageView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMe();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  // The database only returns the page if this person may see it.
  const page = await asUser(me.id, async (db) => (await db.query(
    `select pg.title, pg.kind, pg.body, p.name as project, e.code as episode
       from pages pg join projects p on p.id = pg.project_id
       left join episodes e on e.id = pg.episode_id
      where pg.id = $1`, [id])).rows[0]);
  if (!page) notFound();

  return (
    <article className="max-w-4xl">
      <p className="text-sm text-muted">{page.project}{page.episode ? ` · Episode ${page.episode}` : ""}</p>
      <h1 className="font-display text-3xl font-bold mb-4">{page.title}</h1>
      <div className="card p-6 text-sm text-muted">
        {page.body || `${PAGE_KIND_LABEL[page.kind]}: content arrives in stage 2.`}
      </div>
    </article>
  );
}
