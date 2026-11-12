import "server-only";
import { asUser } from "./db";

export type NavPage = { id: string; title: string; kind: string };
export type NavEpisode = { id: string; code: string; title: string | null; is_active: boolean; pages: NavPage[] };
export type NavProject = {
  id: string; name: string; slug: string;
  pages: NavPage[]; episodes: NavEpisode[];
};

/** Projects, episodes and pages the user may see. The database rules do the filtering. */
export async function navFor(userId: string): Promise<NavProject[]> {
  return asUser(userId, async (db) => {
    const projects = (await db.query(
      "select id, name, slug from projects where not is_archived order by name")).rows;
    const episodes = (await db.query(
      "select id, project_id, code, title, is_active from episodes order by is_active desc, code desc")).rows;
    const pages = (await db.query(
      "select id, project_id, episode_id, title, kind from pages order by sort_order, title")).rows;
    return projects.map((p) => ({
      ...p,
      pages: pages.filter((pg) => pg.project_id === p.id && !pg.episode_id),
      episodes: episodes
        .filter((e) => e.project_id === p.id)
        .map((e) => ({ ...e, pages: pages.filter((pg) => pg.episode_id === e.id) }))
        // People who see no page of an episode don't see the episode either.
        .filter((e) => e.pages.length > 0),
    }));
  });
}

export const USER_TYPES = ["admin", "director", "artist", "client", "observer"] as const;
export type UserType = (typeof USER_TYPES)[number];

export const USER_TYPE_HELP: Record<UserType, string> = {
  admin: "Sees and edits everything. Manages people and projects.",
  director: "Admin access inside the projects they belong to. Cannot manage people.",
  artist: "Sees the pages open to artists. Can only move a shot into the statuses allowed for artists.",
  client: "Sees the pages open to clients, or the pages granted one by one.",
  observer: "Sees every page of their projects except Reports. Edits nothing.",
};

export const PAGE_KINDS = ["shot_tracker", "visual_guide", "doc", "reports", "checklist"] as const;
export const PAGE_KIND_LABEL: Record<string, string> = {
  shot_tracker: "Shot Tracker",
  visual_guide: "Visual Guide",
  doc: "Document",
  reports: "Reports (admins only)",
  checklist: "Checklist",
};
