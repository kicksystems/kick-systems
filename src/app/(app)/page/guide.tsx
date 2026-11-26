import type { Me } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { Markdown } from "@/lib/md";

type PageInfo = { id: string; project_id: string; episode_id: string; project: string; uses_episodes: boolean; episode: string | null };
type Item = { id: string; sequence: string; kind: string; title: string; images: { url: string; name?: string }[]; notes: string };

export async function GuideView({ me, page }: { me: Me; page: PageInfo }) {
  const items = await asUser(me.id, async (db) => (await db.query<Item>(
    "select id, sequence, kind, title, images, notes from guide_items where episode_id=$1 order by sort_order", [page.episode_id])).rows);
  const seqs = [...new Set(items.map((i) => i.sequence))];

  return (
    <div className="max-w-[1300px]">
      <p className="text-sm text-muted">{page.project}{page.uses_episodes && page.episode ? ` · Episode ${page.episode}` : ""}</p>
      <h1 className="text-4xl font-bold">Visual Guides</h1>
      <p className="text-muted mt-1 mb-5">Assets by sequence. They are the references for every shot of the episode.</p>

      {seqs.length > 1 && (
        <nav aria-label="Sequences" className="flex gap-2 overflow-x-auto pb-2 mb-4">
          {seqs.map((q, i) => <a key={q || i} href={`#seq-${i}`} className="btn btn-ghost btn-sm shrink-0">{q || "General"}</a>)}
        </nav>
      )}

      {seqs.map((q, i) => (
        <section key={q || i} id={`seq-${i}`} className="mb-8 scroll-mt-4">
          <h2 className="font-display text-xl font-semibold uppercase mb-3">{q || "General"}</h2>
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
            {items.filter((it) => it.sequence === q).map((it) => (
              <article key={it.id} className="card overflow-hidden">
                {it.images.length > 0 && (
                  <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(it.images.length, 2)}, minmax(0,1fr))` }}>
                    {it.images.slice(0, 4).map((im, j) => (
                      <a key={j} href={im.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={im.url} alt={it.title || im.name || "Reference"} loading="lazy" className="w-full aspect-[4/3] object-cover bg-surface2" />
                      </a>
                    ))}
                  </div>
                )}
                <div className="p-3">
                  {it.kind && <p className="text-[11px] font-bold tracking-wider uppercase text-accent">{it.kind}</p>}
                  <p className="font-semibold leading-snug">{it.title}</p>
                  {it.images.length > 4 && <p className="text-xs text-muted">+{it.images.length - 4} more images</p>}
                  {it.notes && <Markdown text={it.notes} className="text-xs text-muted mt-1" />}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
      {!items.length && <div className="card p-8 text-center text-muted">No assets yet.</div>}
    </div>
  );
}
