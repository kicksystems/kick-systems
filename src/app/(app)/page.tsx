import Link from "next/link";
import { requireMe } from "@/lib/auth";
import { navFor } from "@/lib/queries";

export default async function Home() {
  const me = await requireMe();
  const projects = await navFor(me.id);
  const first = me.full_name.split(" ")[0];

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-3xl font-bold">Welcome back, {first}</h1>
      <p className="text-muted mt-1 mb-6">
        {me.user_type === "artist"
          ? "Your shots, reminders and checklist arrive here in stage 3."
          : "The dashboard (calendar, reports, project panel) arrives here in stage 3."}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {projects.map((p) => (
          <section key={p.id} className="card p-5">
            <h2 className="font-bold text-lg">{p.name}</h2>
            <p className="text-sm text-muted mb-3">
              {p.episodes.filter((e) => e.is_active).length} active episode(s) · {p.episodes.length} in total
            </p>
            <ul className="text-sm space-y-1">
              {p.episodes.filter((e) => e.is_active).map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="font-semibold w-24">Episode {e.code}</span>
                  {e.pages.map((pg) => <Link key={pg.id} className="underline hover:text-accent" href={`/page/${pg.id}`}>{pg.title}</Link>)}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
