import "server-only";
import { createClient } from "@supabase/supabase-js";
import { AUTH_MODE } from "./auth";
import { pool } from "./db";

/**
 * Creates the login account for a new person and returns its id.
 * Online: Supabase sends an invitation e-mail with a link to choose a password.
 * Locally: just creates the account row.
 * Callers must already have checked that the current user is an admin.
 */
export async function createLoginAccount(email: string): Promise<string> {
  if (AUTH_MODE === "dev") {
    const { rows } = await pool.query(
      "insert into auth.users (email) values ($1) on conflict (email) do update set email = excluded.email returning id",
      [email]);
    return rows[0].id;
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.SITE_URL}/auth/accept?next=/auth/set-password`,
  });
  if (error || !data.user) throw new Error(error?.message ?? "Could not invite this e-mail.");
  return data.user.id;
}

/** Sends the invitation again (for people who never chose a password). */
export async function resendInvite(email: string): Promise<void> {
  if (AUTH_MODE === "dev") return;
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.SITE_URL}/auth/accept?next=/auth/set-password`,
  });
  if (error) {
    // Already confirmed accounts cannot be invited again: send a password link instead.
    const { error: e2 } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.SITE_URL}/auth/accept?next=/auth/set-password`,
    });
    if (e2) throw new Error(e2.message);
  }
}

/** Which accounts have never signed in (still waiting to choose a password). */
export async function pendingInvites(): Promise<Set<string>> {
  if (AUTH_MODE === "dev") return new Set();
  const { rows } = await pool.query("select id from auth.users where last_sign_in_at is null");
  return new Set(rows.map((r) => r.id as string));
}
