import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { asUser } from "./db";

/**
 * Two ways to log in:
 *  - AUTH_MODE=supabase (production): e-mail + password through Supabase Auth.
 *  - AUTH_MODE=dev (local only): pick a demo person. Refuses to run in production.
 */
export const AUTH_MODE = (process.env.AUTH_MODE ?? "supabase") as "supabase" | "dev";
if (AUTH_MODE === "dev" && process.env.VERCEL_ENV === "production") {
  throw new Error("AUTH_MODE=dev is not allowed in production.");
}

const DEV_COOKIE = "kick_dev_session";

function sign(value: string) {
  const secret = process.env.DEV_SESSION_SECRET;
  if (!secret) throw new Error("DEV_SESSION_SECRET is missing.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export async function setDevSession(userId: string) {
  (await cookies()).set(DEV_COOKIE, `${userId}.${sign(userId)}`, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearDevSession() {
  (await cookies()).delete(DEV_COOKIE);
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try { list.forEach(({ name, value, options }) => store.set(name, value, options)); }
          catch { /* called from a Server Component: the proxy refreshes the session */ }
        },
      },
    },
  );
}

/** The logged-in user's id, verified. null when nobody is logged in. */
export async function currentUserId(): Promise<string | null> {
  if (AUTH_MODE === "dev") {
    const raw = (await cookies()).get(DEV_COOKIE)?.value;
    if (!raw) return null;
    const [id, sig] = raw.split(".");
    if (!id || !sig) return null;
    const expected = Buffer.from(sign(id));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser(); // verifies the token with Supabase
  return data.user?.id ?? null;
}

export type Me = {
  id: string;
  email: string;
  full_name: string;
  user_type: "admin" | "director" | "artist" | "client" | "observer";
  is_active: boolean;
};

/** The logged-in person's profile, or a redirect to the login page. */
export async function requireMe(): Promise<Me> {
  const id = await currentUserId();
  if (!id) redirect("/login");
  const me = await asUser(id, async (db) => {
    const { rows } = await db.query<Me>(
      "select id, email, full_name, user_type, is_active from profiles where id = $1", [id]);
    return rows[0];
  });
  if (!me || !me.is_active) redirect("/login?error=inactive");
  return me;
}

export async function requireAdmin(): Promise<Me> {
  const me = await requireMe();
  if (me.user_type !== "admin") redirect("/");
  return me;
}
