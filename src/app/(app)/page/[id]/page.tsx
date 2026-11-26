import { notFound } from "next/navigation";
import { requireMe } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { PAGE_KIND_LABEL } from "@/lib/queries";
import { Markdown } from "@/lib/md";
import { TrackerView } from "../tracker";
import { GuideView } from "../guide";

export default async function PageView({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireMe();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  // The database only returns the page if this person may see it.
  const page = await asUser(me.id, async (db) => (await db.query(
    `select pg.id, pg.title, pg.kind, pg.body, pg.project_id, pg.episode_id, p.name as project, p.uses_episodes, e.code as episode
       from pages pg join projects p on p.id = pg.project_id
       left join episodes e on e.id = pg.episode_id
      where pg.id = $1`, [id])).rows[0]);
  if (!page) notFound();

  if (page.kind === "shot_tracker" && page.episode_id) return <TrackerView me={me} page={page} sp={sp} />;
  if (page.kind === "visual_guide" && page.episode_id) return <GuideView me={me} page={page} />;

  return (
    <article className="max-w-4xl">
      <p className="text-sm text-muted">{page.project}{page.episode ? ` · Episode ${page.episode}` : ""}</p>
      <h1 className="text-3xl font-bold mb-4">{page.title}</h1>
      <div className="card p-6 text-sm">
        {page.body ? <Markdown text={page.body} /> : <p className="text-muted">{PAGE_KIND_LABEL[page.kind]}: no content yet.</p>}
      </div>
    </article>
  );
}
