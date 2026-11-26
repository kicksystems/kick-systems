"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireMe } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { PAGE_KINDS, USER_TYPES } from "@/lib/queries";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const slugify = (name: string) =>
  name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const visibleTo = (fd: FormData) =>
  fd.getAll("visible_to").map(String).filter((t) => (USER_TYPES as readonly string[]).includes(t));
const kind = (fd: FormData) => {
  const k = s(fd, "kind");
  if (!(PAGE_KINDS as readonly string[]).includes(k)) throw new Error("Unknown page type.");
  return k;
};
const color = (fd: FormData) => (/^#[0-9a-fA-F]{6}$/.test(s(fd, "color")) ? s(fd, "color") : "#9ca3af");

function done(projectId: string) {
  revalidatePath("/", "layout");
  redirect(`/admin/projects/${projectId}?saved=1`);
}

// ── Projects ──
export async function createProject(fd: FormData) {
  const me = await requireAdmin();
  const name = s(fd, "name");
  const source = s(fd, "copy_from");
  if (!name) throw new Error("Name is required.");
  const slug = slugify(name);
  const id = await asUser(me.id, async (db) => {
    if (source) {
      return (await db.query("select public.copy_project($1,$2,$3) as id", [source, name, slug])).rows[0].id as string;
    }
    const pid = (await db.query(
      "insert into projects (name, slug, description, uses_episodes, created_by) values ($1,$2,$3,$4,$5) returning id",
      [name, slug, s(fd, "description") || null, fd.get("uses_episodes") === "on", me.id])).rows[0].id as string;
    // A blank project starts with one status so the workflow is never empty.
    await db.query("insert into statuses (project_id, name, sort_order, is_initial) values ($1,'Not Started',1,true)", [pid]);
    if (fd.get("uses_episodes") !== "on") {
      // One Shot Tracker split by scenes: the project keeps one hidden episode, so counts and reports work the same way.
      await db.query("insert into episode_page_templates (project_id, title, kind, visible_to, sort_order) values ($1,'Shots','shot_tracker','{artist,client}',1)", [pid]);
      await db.query("insert into episodes (project_id, code, title) values ($1,'shots','Shots')", [pid]);
    }
    return pid;
  });
  await asUser(me.id, (db) => db.query("insert into project_members values ($1,$2) on conflict do nothing", [id, me.id]));
  revalidatePath("/", "layout");
  redirect(`/admin/projects/${id}`);
}

export async function updateProject(fd: FormData) {
  const me = await requireMe(); // directors may edit their projects; the database checks it
  const id = s(fd, "id");
  await asUser(me.id, (db) => db.query(
    "update projects set name=$2, description=$3, uses_episodes=$4, is_archived=$5 where id=$1",
    [id, s(fd, "name"), s(fd, "description") || null, fd.get("uses_episodes") === "on", fd.get("is_archived") === "on"]));
  done(id);
}

// ── Episodes ──
export async function addEpisode(fd: FormData) {
  const me = await requireMe();
  const pid = s(fd, "project_id");
  const code = s(fd, "code");
  if (!code) throw new Error("Episode number is required.");
  await asUser(me.id, (db) => db.query("insert into episodes (project_id, code, title) values ($1,$2,$3)",
    [pid, code, s(fd, "title") || null]));
  done(pid);
}

export async function toggleEpisode(fd: FormData) {
  const me = await requireMe();
  const pid = s(fd, "project_id");
  await asUser(me.id, (db) => db.query("update episodes set is_active = not is_active where id=$1 and project_id=$2",
    [s(fd, "id"), pid]));
  done(pid);
}

// ── Workflow ──
export async function saveStatus(fd: FormData) {
  const me = await requireMe();
  const pid = s(fd, "project_id");
  const id = s(fd, "id");
  const types = fd.getAll("allowed").map(String).filter((t) => ["artist", "client", "observer"].includes(t));
  await asUser(me.id, async (db) => {
    let sid = id;
    if (fd.get("is_initial") === "on") await db.query("update statuses set is_initial=false where project_id=$1", [pid]);
    if (id) {
      await db.query(
        "update statuses set name=$3, color=$4, sort_order=$5, counts_as_done=$6, is_initial = is_initial or $7 where id=$1 and project_id=$2",
        [id, pid, s(fd, "name"), color(fd), Number(s(fd, "sort_order")) || 0, fd.get("counts_as_done") === "on", fd.get("is_initial") === "on"]);
    } else {
      sid = (await db.query(
        `insert into statuses (project_id, name, color, sort_order, counts_as_done, is_initial)
         values ($1,$2,$3,coalesce($4,(select coalesce(max(sort_order),0)+1 from statuses where project_id=$1)),$5,$6) returning id`,
        [pid, s(fd, "name"), color(fd), Number(s(fd, "sort_order")) || null, fd.get("counts_as_done") === "on", fd.get("is_initial") === "on"])).rows[0].id;
    }
    await db.query("delete from status_permissions where status_id=$1", [sid]);
    for (const t of types) await db.query("insert into status_permissions values ($1,$2)", [sid, t]);
  });
  done(pid);
}

export async function deleteStatus(fd: FormData) {
  const me = await requireMe();
  const pid = s(fd, "project_id");
  await asUser(me.id, (db) => db.query("delete from statuses where id=$1 and project_id=$2 and not is_initial", [s(fd, "id"), pid]));
  done(pid);
}

// ── Pages and episode page templates ──
export async function savePage(fd: FormData) {
  const me = await requireMe();
  const pid = s(fd, "project_id");
  const table = s(fd, "scope") === "template" ? "episode_page_templates" : "pages";
  const id = s(fd, "id");
  await asUser(me.id, (db) => id
    ? db.query(`update ${table} set title=$3, kind=$4, visible_to=$5, sort_order=$6 where id=$1 and project_id=$2`,
        [id, pid, s(fd, "title"), kind(fd), visibleTo(fd), Number(s(fd, "sort_order")) || 0])
    : db.query(`insert into ${table} (project_id, title, kind, visible_to, sort_order) values ($1,$2,$3,$4,$5)`,
        [pid, s(fd, "title"), kind(fd), visibleTo(fd), Number(s(fd, "sort_order")) || 0]));
  done(pid);
}

export async function deletePage(fd: FormData) {
  const me = await requireMe();
  const pid = s(fd, "project_id");
  const table = s(fd, "scope") === "template" ? "episode_page_templates" : "pages";
  await asUser(me.id, (db) => db.query(`delete from ${table} where id=$1 and project_id=$2`, [s(fd, "id"), pid]));
  done(pid);
}

// ── Shot Tracker settings: columns (which, in what order, with what label), scenes, type label ──
export async function saveTrackerSettings(fd: FormData) {
  const me = await requireMe();
  const pid = s(fd, "project_id");
  const { TRACKER_COLUMNS } = await import("@/lib/shots");
  const cols = TRACKER_COLUMNS
    .map((c) => ({ k: c.k as string, on: fd.get(`col_${c.k}`) === "on", order: Number(s(fd, `ord_${c.k}`)) || 99, label: s(fd, `lab_${c.k}`) }))
    .filter((c) => c.on)
    .sort((a, b) => a.order - b.order);
  const labels = Object.fromEntries(cols.filter((c) => c.label && c.label !== TRACKER_COLUMNS.find((x) => x.k === c.k)?.t).map((c) => [c.k, c.label]));
  const scenes = s(fd, "scenes").split("\n").map((x) => x.trim()).filter(Boolean);
  await asUser(me.id, (db) => db.query(
    "update projects set tracker_columns=$2, column_labels=$3, scenes=$4, type_label=nullif($5,'') where id=$1",
    [pid, cols.map((c) => c.k), JSON.stringify(labels), scenes, s(fd, "type_label")]));
  done(pid);
}
