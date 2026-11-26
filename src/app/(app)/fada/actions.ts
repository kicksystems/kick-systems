"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { asUser } from "@/lib/db";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const id = (v: string) => (/^[0-9a-f-]{36}$/.test(v) ? v : null);

export async function addReminder(fd: FormData) {
  const me = await requireAdmin();
  const body = s(fd, "body");
  if (!body) return;
  const days = Number(s(fd, "days"));
  await asUser(me.id, (db) => db.query(
    `insert into reminders (project_id, recipient_id, body, created_by, expires_at)
     values ($1, $2, $3, $4, case when $5::int > 0 then now() + make_interval(days => $5::int) end)`,
    [id(s(fd, "project")), id(s(fd, "to")), body, me.id, Number.isFinite(days) ? days : 0]));
  revalidatePath("/fada");
  revalidatePath("/");
}

export async function deleteReminder(fd: FormData) {
  const me = await requireAdmin();
  await asUser(me.id, (db) => db.query("delete from reminders where id=$1", [id(s(fd, "id"))]));
  revalidatePath("/fada");
  revalidatePath("/");
}
