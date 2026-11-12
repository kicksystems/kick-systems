import Link from "next/link";
import { requireMe } from "@/lib/auth";
import { navFor } from "@/lib/queries";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMe();
  const projects = await navFor(me.id);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="bg-sidebar border-r border-line md:min-h-dvh md:sticky md:top-0 md:h-dvh md:overflow-y-auto">
        <div className="px-4 pt-5 pb-3 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-bold text-accent">Kick Systems</Link>
          <label htmlFor="nav-toggle" className="md:hidden btn btn-ghost cursor-pointer">Menu</label>
        </div>
        <input id="nav-toggle" type="checkbox" className="peer sr-only" aria-label="Show menu" />

        <div className="hidden peer-checked:block md:block">
        <nav aria-label="Main" className="px-3 pb-6 text-sm">
          <ul className="space-y-0.5 mb-5">
            <NavLink href="/">Home</NavLink>
            <li><span className="block px-2 py-1.5 text-muted" title="Arrives in stage 5">Calendar <span className="text-xs">(soon)</span></span></li>
            {me.user_type === "admin" && (<>
              <NavLink href="/admin/users">People</NavLink>
              <NavLink href="/admin/projects">Projects</NavLink>
            </>)}
          </ul>

          {projects.length === 0 && (
            <p className="px-2 text-muted text-xs">You are not on any project yet. An admin adds you.</p>
          )}

          {projects.map((p) => (
            <details key={p.id} open className="mb-4 group">
              <summary className="flex items-center justify-between px-2 py-1 cursor-pointer list-none font-bold tracking-wide uppercase text-xs">
                {p.name}
                <span aria-hidden className="text-muted transition-transform group-open:rotate-180">▾</span>
              </summary>

              {p.pages.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {p.pages.map((pg) => <NavLink key={pg.id} href={`/page/${pg.id}`}>{pg.title}</NavLink>)}
                </ul>
              )}

              <div className="mt-2 space-y-2">
                {p.episodes.map((e) => (
                  <details key={e.id} open={e.is_active} className="rounded-xl bg-surface/70 border border-line">
                    <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between">
                      <span className="font-semibold">Episode {e.code}</span>
                      {!e.is_active && <span className="text-[11px] text-muted">closed</span>}
                    </summary>
                    <div className="px-3 pb-3">
                      <div className="h-1.5 rounded-full bg-line overflow-hidden" aria-label="Ready for Delivery progress: arrives with the Shot Tracker">
                        <div className="h-full bg-accent w-0" />
                      </div>
                      <p className="text-[11px] text-muted mt-1">Progress appears with the Shot Tracker</p>
                      <ul className="mt-2 space-y-0.5">
                        {e.pages.map((pg) => (
                          <li key={pg.id}><Link className="underline underline-offset-2 text-xs uppercase tracking-wide hover:text-accent" href={`/page/${pg.id}`}>{pg.title}</Link></li>
                        ))}
                      </ul>
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-line text-sm">
          <p className="font-semibold">{me.full_name}</p>
          <p className="text-muted text-xs mb-2 capitalize">{me.user_type}</p>
          <form action={logout}><button className="text-xs underline text-muted hover:text-accent">Log out</button></form>
        </div>
        </div>
      </aside>

      <main className="px-4 md:px-8 py-6 min-w-0">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li><Link href={href} className="block px-2 py-1.5 rounded-lg hover:bg-surface">{children}</Link></li>
  );
}
