import Link from "next/link";
import { requireMe } from "@/lib/auth";
import { navFor } from "@/lib/queries";
import { logout } from "../login/actions";
import { SubmitButton } from "@/components/submit-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMe();
  const projects = await navFor(me.id);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="rail md:sticky md:top-0 md:h-dvh md:overflow-y-auto flex flex-col">
        <div className="px-4 pt-5 pb-3 flex items-center justify-between gap-3">
          <Link href="/" aria-label="Kick Pictures, home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/kick-logo.webp" alt="Kick Pictures" width={170} height={80} className="block w-[150px] md:w-[170px] h-auto" />
          </Link>
          <label htmlFor="nav-toggle" className="md:hidden btn btn-ghost btn-sm !text-[var(--rail-ink)] !border-[var(--rail-line)] cursor-pointer">Menu</label>
        </div>
        <input id="nav-toggle" type="checkbox" className="peer sr-only" aria-label="Show menu" />

        <div className="hidden peer-checked:flex md:flex flex-col grow">
          <nav aria-label="Main" className="px-3 pb-6 text-sm">
            <ul className="space-y-0.5 mb-4">
              <li><Link href="/" className="rail-link">Home</Link></li>
              <li><span className="rail-link rail-muted" title="Arrives with the calendar stage">Calendar <span className="text-xs">(soon)</span></span></li>
              {(me.user_type === "admin" || me.user_type === "director") && <li><Link href="/reports" className="rail-link">Reports</Link></li>}
              {me.user_type === "admin" && (<>
                <li><Link href="/fada" className="rail-link">Fada dos shots</Link></li>
                <li><Link href="/artists" className="rail-link">Artist Management</Link></li>
                <li><Link href="/admin/users" className="rail-link">People</Link></li>
                <li><Link href="/admin/projects" className="rail-link">Projects</Link></li>
              </>)}
              {me.user_type !== "client" && <li><Link href="/checklists" className="rail-link">Checklists</Link></li>}
            </ul>

            {projects.length === 0 && (
              <p className="px-2 rail-muted text-xs">You are not on any project yet. An admin adds you.</p>
            )}

            {projects.map((p) => (
              <details key={p.id} open className="mb-3 group">
                <summary className="flex items-center justify-between px-2 py-1.5 cursor-pointer list-none rail-proj rounded-lg hover:bg-white/10">
                  {p.name}
                  <span aria-hidden className="rail-muted text-[10px] transition-transform group-open:rotate-180">▾</span>
                </summary>

                {p.pages.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {p.pages.map((pg) => <li key={pg.id}><Link href={`/page/${pg.id}`} className="rail-link">{pg.title}</Link></li>)}
                  </ul>
                )}

                <div className="mt-1">
                  {p.episodes.map((e) => (
                    <details key={e.id} open={e.is_active} className="rail-ep">
                      <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between font-semibold">
                        <span>{p.uses_episodes ? `Episode ${e.code}` : "Shots"}</span>
                        <span className="text-[11px] rail-muted font-medium">{e.is_active ? `${e.pct}%` : "closed"}</span>
                      </summary>
                      <div className="px-3 pb-3">
                        <div className="rail-bar" role="img" aria-label={`${e.done} of ${e.total} shots done`}><i style={{ width: `${e.pct}%` }} /></div>
                        <p className="text-[11px] rail-muted mt-1">{e.done} of {e.total} shots Ready for Delivery</p>
                        <ul className="mt-2 space-y-0.5">
                          {e.pages.map((pg) => (
                            <li key={pg.id}><Link className="block text-xs uppercase tracking-wide py-0.5 hover:underline" href={`/page/${pg.id}`}>{pg.title}</Link></li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            ))}
          </nav>

          <div className="mt-auto px-4 py-4 border-t border-[var(--rail-line)] text-sm">
            <p className="font-semibold">{me.full_name}</p>
            <p className="rail-muted text-xs mb-2 capitalize">{me.user_type}</p>
            <form action={logout}><SubmitButton className="text-xs underline rail-muted hover:text-white">Log out</SubmitButton></form>
            <p className="text-[10.5px] leading-relaxed rail-muted opacity-85 mt-3">
              Powered by Kick Systems<br />© 2026 Kick Pictures. All rights reserved.<br />
              <a href="https://kickpictures.com" target="_blank" rel="noreferrer" className="underline">kickpictures.com</a>
            </p>
          </div>
        </div>
      </aside>

      <main className="px-4 md:px-8 py-6 min-w-0">{children}</main>
    </div>
  );
}
