"use client";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

// Invitation and password e-mails land here. Supabase puts the session either in the address
// (#access_token=…, from invitations) or as ?code=… (password reset). Either way the session is
// stored in this browser and the person goes on to choose a password.
export default function Accept() {
  const [msg, setMsg] = useState("Signing you in…");
  useEffect(() => {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const url = new URL(window.location.href);
    const nextRaw = url.searchParams.get("next") ?? "/auth/set-password";
    const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/auth/set-password";
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const go = (ok: boolean) => {
      if (ok) window.location.replace(next);
      else setMsg("This link has expired or was already used. Ask an admin to send a new invitation, or use “Forgot your password?” on the login page.");
    };
    const code = url.searchParams.get("code");
    const at = hash.get("access_token"), rt = hash.get("refresh_token");
    if (hash.get("error_description")) { setMsg(hash.get("error_description")!.replace(/\+/g, " ")); return; }
    if (at && rt) supabase.auth.setSession({ access_token: at, refresh_token: rt }).then(({ error }) => go(!error));
    else if (code) supabase.auth.exchangeCodeForSession(code).then(({ error }) => go(!error));
    else go(false);
  }, []);
  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <div className="card p-6 max-w-sm text-center">
        <p className="font-display text-2xl font-bold text-accent uppercase">Kick Systems</p>
        <p className="mt-3 text-sm">{msg}</p>
        <a href="/login" className="text-sm underline text-muted mt-4 inline-block">Go to the login page</a>
      </div>
    </main>
  );
}
