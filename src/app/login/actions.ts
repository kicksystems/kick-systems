"use server";
import { redirect } from "next/navigation";
import { AUTH_MODE, clearDevSession, setDevSession, supabaseServer } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function devLogin(formData: FormData) {
  if (AUTH_MODE !== "dev") throw new Error("Not available.");
  const id = String(formData.get("userId") ?? "");
  const { rows } = await pool.query("select id from profiles where id = $1 and is_active", [id]);
  if (!rows[0]) redirect("/login?error=inactive");
  await setDevSession(id);
  redirect("/");
}

export async function passwordLogin(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=credentials");
  redirect("/");
}

export async function forgotPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.SITE_URL}/auth/callback?next=/auth/set-password`,
  });
  // Same answer whether or not the e-mail exists.
  redirect("/login?sent=1");
}

export async function logout() {
  if (AUTH_MODE === "dev") await clearDevSession();
  else await (await supabaseServer()).auth.signOut();
  redirect("/login");
}
