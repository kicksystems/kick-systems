"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { asUser } from "@/lib/db";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const uuid = (v: string) => (/^[0-9a-f-]{36}$/.test(v) ? v : null);
const KINDS = ["Full Time", "Part Time", "Offline", "Dr. Appointment", "School Adapt"];
const kind = (v: string) => (KINDS.includes(v) ? v : "Full Time");
const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const days = (v: string) => Math.max(0, Math.min(366, Math.round(Number(v) || 0)));

export async function addAvailability(fd: FormData) {
  const me = await requireAdmin();
  await asUser(me.id, (db) => db.query(
    "insert into artist_availability (person_id, kind, note, start_date, days) values ($1,$2,$3,$4,$5)",
    [uuid(s(fd, "person")), kind(s(fd, "kind")), s(fd, "note"), date(s(fd, "start")), days(s(fd, "days"))]));
  revalidatePath("/artists");
}

export async function saveAvailability(fd: FormData) {
  const me = await requireAdmin();
  await asUser(me.id, (db) => db.query(
    "update artist_availability set person_id=$2, kind=$3, note=$4, start_date=$5, days=$6 where id=$1",
    [uuid(s(fd, "id")), uuid(s(fd, "person")), kind(s(fd, "kind")), s(fd, "note"), date(s(fd, "start")), days(s(fd, "days"))]));
  revalidatePath("/artists");
}

export async function deleteAvailability(fd: FormData) {
  const me = await requireAdmin();
  await asUser(me.id, (db) => db.query("delete from artist_availability where id=$1", [uuid(s(fd, "id"))]));
  revalidatePath("/artists");
}

export async function saveContact(fd: FormData) {
  const me = await requireAdmin();
  await asUser(me.id, (db) => db.query(
    `insert into artist_contacts (person_id, phone, runway, portfolio) values ($1,$2,$3,$4)
     on conflict (person_id) do update set phone=excluded.phone, runway=excluded.runway, portfolio=excluded.portfolio, updated_at=now()`,
    [uuid(s(fd, "person")), s(fd, "phone"), s(fd, "runway"), s(fd, "portfolio")]));
  revalidatePath("/artists");
}
