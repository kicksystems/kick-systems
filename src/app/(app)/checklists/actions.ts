"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { asUser } from "@/lib/db";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const phrases = (fd: FormData) => s(fd, "phrases").split("\n").map((x) => x.trim()).filter(Boolean);
const pid = (v: string) => (/^[0-9a-f-]{36}$/.test(v) ? v : null);

export async function addRule(fd: FormData) {
  const me = await requireAdmin();
  if (!s(fd, "rule")) return;
  await asUser(me.id, (db) => db.query(
    `insert into checklist_rules (project_id, rule, phrases, sort_order)
     values ($1, $2, $3, coalesce((select max(sort_order) + 1 from checklist_rules where project_id is not distinct from $1), 1))`,
    [pid(s(fd, "project")), s(fd, "rule"), phrases(fd)]));
  revalidatePath("/checklists");
}

export async function saveRule(fd: FormData) {
  const me = await requireAdmin();
  await asUser(me.id, (db) => db.query("update checklist_rules set rule=$2, phrases=$3 where id=$1", [pid(s(fd, "id")), s(fd, "rule"), phrases(fd)]));
  revalidatePath("/checklists");
}

export async function deleteRule(fd: FormData) {
  const me = await requireAdmin();
  await asUser(me.id, (db) => db.query("delete from checklist_rules where id=$1", [pid(s(fd, "id"))]));
  revalidatePath("/checklists");
}
