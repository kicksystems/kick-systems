import "server-only";
import type { PoolClient } from "pg";
import { DEFAULT_CATEGORIES, type Category, type Row, type Settings } from "./model";

export const ISO = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
export type RowState = { id: string; date: string; prep_date: string | null; prep_hidden: boolean; deleted: boolean };
export type Change = {
  id: string; actor_id: string | null; actor_name: string; kind: string; summary: string; result_revision: number;
  rows_before: RowState[]; rows_after: RowState[]; created_at: string;
};

export function defaultSettings(projectId: string): Settings {
  return { project_id: projectId, name: "Calendar", working_days: [1, 2, 3, 4, 5], prep_category: "recre", prep_lead_days: 1,
    prep_name: "RECRE DUE, EDIT, LAST LOOKS", categories: DEFAULT_CATEGORIES, revision: 0, updated_at: new Date(0).toISOString() };
}

export async function loadSettings(db: PoolClient, projectId: string, lock = false): Promise<Settings> {
  const r = (await db.query<Settings>(
    `select project_id, name, working_days, prep_category, prep_lead_days, prep_name, categories, revision, ${ISO("updated_at")} as updated_at
       from calendar_settings where project_id = $1 ${lock ? "for update" : ""}`, [projectId])).rows[0];
  if (!r) return defaultSettings(projectId);
  return { ...r, categories: (r.categories as Category[])?.length ? r.categories : DEFAULT_CATEGORIES };
}

/** Creates the settings row on first write, so the revision lock always has a row to hold. */
export async function lockSettings(db: PoolClient, projectId: string): Promise<Settings> {
  await db.query(
    `insert into calendar_settings (project_id, categories) values ($1, $2) on conflict (project_id) do nothing`,
    [projectId, JSON.stringify(DEFAULT_CATEGORIES)]);
  return loadSettings(db, projectId, true);
}

export async function loadRows(db: PoolClient, projectId: string): Promise<Row[]> {
  return (await db.query<Row>(
    `select id, episode, category, title, to_char(date,'YYYY-MM-DD') as date, stage, ripple_linked, origin,
            to_char(prep_date,'YYYY-MM-DD') as prep_date, prep_hidden
       from calendar_events where project_id = $1 and deleted_at is null`, [projectId])).rows;
}

export async function rowStates(db: PoolClient, ids: string[]): Promise<RowState[]> {
  if (!ids.length) return [];
  return (await db.query<RowState>(
    `select id, to_char(date,'YYYY-MM-DD') as date, to_char(prep_date,'YYYY-MM-DD') as prep_date, prep_hidden, deleted_at is not null as deleted
       from calendar_events where id = any($1) order by id`, [ids])).rows;
}

export async function latestChange(db: PoolClient, projectId: string): Promise<Change | null> {
  return (await db.query<Change>(
    `select id, actor_id, actor_name, kind, summary, result_revision, rows_before, rows_after, ${ISO("created_at")} as created_at
       from calendar_changes where project_id = $1 order by result_revision desc, created_at desc limit 1`, [projectId]).catch(() => ({ rows: [] as Change[] }))).rows[0] ?? null;
}
