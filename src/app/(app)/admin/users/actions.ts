"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createLoginAccount, resendInvite as resend } from "@/lib/auth-admin";
import { asUser } from "@/lib/db";
import { USER_TYPES } from "@/lib/queries";

function readPerson(fd: FormData) {
  const full_name = String(fd.get("full_name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const user_type = String(fd.get("user_type") ?? "");
  const discord = String(fd.get("discord_user_id") ?? "").trim();
  const projects = fd.getAll("projects").map(String);
  if (!full_name) throw new Error("Name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid e-mail is required.");
  if (!(USER_TYPES as readonly string[]).includes(user_type)) throw new Error("Pick a user type.");
  if (discord && !/^\d{15,22}$/.test(discord)) throw new Error("Discord ID must be the numeric ID.");
  return { full_name, email, user_type, discord: discord || null, projects };
}

export async function addPerson(fd: FormData) {
  const me = await requireAdmin();
  const p = readPerson(fd);
  const id = await createLoginAccount(p.email);
  await asUser(me.id, async (db) => {
    await db.query(
      `insert into profiles (id, email, full_name, user_type, discord_user_id) values ($1,$2,$3,$4,$5)`,
      [id, p.email, p.full_name, p.user_type, p.discord]);
    for (const pid of p.projects) {
      await db.query("insert into project_members (project_id, user_id) values ($1,$2) on conflict do nothing", [pid, id]);
    }
  });
  revalidatePath("/", "layout");
  redirect("/admin/users?added=1");
}

export async function updatePerson(fd: FormData) {
  const me = await requireAdmin();
  const id = String(fd.get("id"));
  const p = readPerson(fd);
  const is_active = fd.get("is_active") === "on";
  await asUser(me.id, async (db) => {
    await db.query(
      `update profiles set full_name=$2, user_type=$3, discord_user_id=$4, is_active=$5 where id=$1`,
      [id, p.full_name, p.user_type, p.discord, is_active]);
    await db.query("delete from project_members where user_id=$1 and not (project_id = any($2::uuid[]))", [id, p.projects]);
    for (const pid of p.projects) {
      await db.query("insert into project_members (project_id, user_id) values ($1,$2) on conflict do nothing", [pid, id]);
    }
  });
  revalidatePath("/", "layout");
  redirect("/admin/users?saved=1");
}

export async function resendInvite(fd: FormData) {
  const me = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const email = await asUser(me.id, async (db) => (await db.query("select email from profiles where id=$1", [id])).rows[0]?.email as string | undefined);
  if (!email) throw new Error("Person not found.");
  await resend(email);
  redirect("/admin/users?invited=1");
}
