"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMe } from "@/lib/auth";
import { asUser } from "@/lib/db";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const uuid = (v: string) => (/^[0-9a-f-]{36}$/.test(v) ? v : (() => { throw new Error("Bad id."); })());
const back = (fd: FormData) => {
  const to = s(fd, "back");
  return to.startsWith("/") && !to.startsWith("//") ? to : "/";
};

// Status: the database decides who may move which shot where (set_shot_status).
export async function setStatus(fd: FormData) {
  const me = await requireMe();
  await asUser(me.id, (db) => db.query("select public.set_shot_status($1,$2)", [uuid(s(fd, "shot")), uuid(s(fd, "status"))]));
  revalidatePath("/", "layout");
}

// Internal notes, signed "(Name, Nov 23) - text". Only admins and the director (checked by the database).
export async function addNote(fd: FormData) {
  const me = await requireMe();
  const body = s(fd, "body");
  if (body) {
    await asUser(me.id, (db) => db.query(
      "insert into shot_notes (shot_id, author_id, author_name, body) values ($1,$2,$3,$4)",
      [uuid(s(fd, "shot")), me.id, me.full_name.split(" ")[0], body]));
  }
  revalidatePath(back(fd));
}

export async function deleteNote(fd: FormData) {
  const me = await requireMe();
  await asUser(me.id, (db) => db.query("delete from shot_notes where id=$1", [uuid(s(fd, "note"))]));
  revalidatePath(back(fd));
}

// Elves Notes and Showrunner Notes.
export async function saveClientNote(fd: FormData) {
  const me = await requireMe();
  await asUser(me.id, (db) => db.query("select public.set_client_note($1,$2,$3)", [uuid(s(fd, "shot")), s(fd, "field"), String(fd.get("body") ?? "")]));
  revalidatePath(back(fd));
}

// Whole shot (admins and the director; the database refuses everyone else).
export async function saveShot(fd: FormData) {
  const me = await requireMe();
  const id = uuid(s(fd, "id"));
  const artist = s(fd, "artist_id");
  await asUser(me.id, async (db) => {
    const r = await db.query(
      `update shots set code=$2, act=nullif($3,''), sequence=nullif($4,''), slate=nullif($5,''), timecodes=nullif($6,''),
              duration=nullif($7,''), brief=$8, artist_id=nullif($9,'')::uuid, due_date=nullif($10,'')::date, drive_url=nullif($11,''),
              director_notes=$12, showrunner_notes=$13, elves_notes=$14
        where id=$1`,
      [id, s(fd, "code"), s(fd, "act"), s(fd, "sequence"), s(fd, "slate"), s(fd, "timecodes"), s(fd, "duration"),
       String(fd.get("brief") ?? ""), artist && /^[0-9a-f-]{36}$/.test(artist) ? artist : "", s(fd, "due_date"),
       /^https:\/\//.test(s(fd, "drive_url")) ? s(fd, "drive_url") : "",
       String(fd.get("director_notes") ?? ""), String(fd.get("showrunner_notes") ?? ""), String(fd.get("elves_notes") ?? "")]);
    if (r.rowCount === 0) throw new Error("You cannot edit this shot.");
    const status = s(fd, "status_id");
    if (status) await db.query("select public.set_shot_status($1,$2)", [id, uuid(status)]);
  });
  revalidatePath("/", "layout");
  redirect(back(fd));
}

export async function addShot(fd: FormData) {
  const me = await requireMe();
  const ep = uuid(s(fd, "episode"));
  const id = await asUser(me.id, async (db) => {
    const r = await db.query(
      `insert into shots (project_id, episode_id, code, sequence, status_id, sort_order)
       select e.project_id, e.id, $2, nullif($3,''),
              (select id from statuses where project_id = e.project_id and is_initial limit 1),
              coalesce((select max(sort_order) + 1 from shots where episode_id = e.id), 1)
         from episodes e where e.id = $1 returning id`,
      [ep, s(fd, "code") || "New shot", s(fd, "sequence")]);
    return r.rows[0]?.id as string | undefined;
  });
  if (!id) throw new Error("You cannot add shots here.");
  revalidatePath("/", "layout");
  redirect(`/shot/${id}?back=${encodeURIComponent(back(fd))}`);
}

export async function deleteShot(fd: FormData) {
  const me = await requireMe();
  await asUser(me.id, (db) => db.query("delete from shots where id=$1", [uuid(s(fd, "id"))]));
  revalidatePath("/", "layout");
  redirect(back(fd));
}
