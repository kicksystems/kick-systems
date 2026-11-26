import "server-only";
import { pool } from "./db";
import { seconds } from "./shots";

/**
 * Import from Superhuman Docs (formerly Coda), read only.
 * Reads the episode pages under the hub page, their Shot Tracker (rows) and Visual Guides (page content),
 * and writes them into Kick Systems. Running it again updates what came from Coda, but never overwrites
 * a shot that was already changed in Kick Systems (edited_here).
 *
 * Settings (Vercel environment variables, never in the code):
 *   CODA_API_TOKEN  read-only API token
 *   CODA_DOC_ID     the doc that holds the hub page
 *   CODA_HUB_PAGE   name of the hub page (default "PEKS Hub")
 */

const BASE = process.env.CODA_API_BASE || "https://coda.io/apis/v1";
const DOC = () => {
  const d = process.env.CODA_DOC_ID;
  if (!d) throw new Error("CODA_DOC_ID is missing.");
  return d;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.CODA_API_TOKEN;
  if (!token) throw new Error("CODA_API_TOKEN is missing.");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (res.status === 429 && attempt < 4) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`Superhuman Docs API ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<T>;
  }
}

async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const r = await api<{ items: T[]; nextPageToken?: string }>(`${path}${token ? `${sep}pageToken=${encodeURIComponent(token)}` : ""}`);
    out.push(...r.items);
    token = r.nextPageToken;
  } while (token);
  return out;
}

type CodaPage = { id: string; name: string; parent?: { id: string }; children?: { id: string; name: string }[] };
type CodaTable = { id: string; name: string; tableType: "table" | "view"; parent?: { id: string; name?: string } };
type CodaRow = { id: string; index: number; createdAt?: string; updatedAt?: string; values: Record<string, unknown> };

export async function exportPageMarkdown(pageId: string): Promise<string> {
  const doc = DOC();
  const start = await api<{ id: string }>(`/docs/${doc}/pages/${encodeURIComponent(pageId)}/export`, {
    method: "POST", body: JSON.stringify({ outputFormat: "markdown" }),
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, i < 5 ? 700 : 1500));
    const st = await api<{ status: string; downloadLink?: string; error?: string }>(
      `/docs/${doc}/pages/${encodeURIComponent(pageId)}/export/${start.id}`);
    if (st.status === "complete" && st.downloadLink) {
      const res = await fetch(st.downloadLink, { cache: "no-store" });
      return res.text();
    }
    if (st.status === "failed") throw new Error(`Export failed: ${st.error ?? "unknown"}`);
  }
  throw new Error("Export took too long.");
}

// ─────────── Finding the episodes ───────────
export type FoundEpisode = {
  code: string; title: string | null; pageId: string; pageName: string;
  trackerPageId: string | null; guidePageId: string | null; tableId: string | null; tableName: string | null;
};

export async function findEpisodes(): Promise<FoundEpisode[]> {
  const doc = DOC();
  const hubName = (process.env.CODA_HUB_PAGE || "PEKS Hub").toLowerCase();
  const pages = await all<CodaPage>(`/docs/${doc}/pages?limit=500`);
  const hub = pages.find((p) => p.name.toLowerCase().includes(hubName));
  if (!hub) throw new Error("Hub page not found.");
  const tables = await all<CodaTable>(`/docs/${doc}/tables?limit=500&tableTypes=table,view`);
  const childrenOf = (id: string) => pages.filter((p) => p.parent?.id === id);
  const below = (id: string): CodaPage[] => childrenOf(id).flatMap((c) => [c, ...below(c.id)]);

  return childrenOf(hub.id)
    .map((p) => ({ p, m: /^PEKS\s*-\s*(\d{3})(?:\s*-\s*(.+))?$/i.exec(p.name.trim()) }))
    .filter((x) => x.m && !/backup|template|archive/i.test(x.p.name))
    .map(({ p, m }) => {
      const sub = below(p.id);
      const trackerPages = sub.filter((c) => /shot tracker/i.test(c.name));
      const trackerPage = trackerPages.find((c) => /admin view/i.test(c.name)) ?? trackerPages[0] ?? null;
      const guidePage = sub.find((c) => /visual guide/i.test(c.name)) ?? null;
      const onTracker = trackerPage ? tables.filter((t) => t.parent?.id === trackerPage.id) : [];
      const table = onTracker.find((t) => /shot tracker/i.test(t.name)) ?? onTracker[0] ?? null;
      return {
        code: m![1], title: m![2]?.trim() || null, pageId: p.id, pageName: p.name,
        trackerPageId: trackerPage?.id ?? null, guidePageId: guidePage?.id ?? null,
        tableId: table?.id ?? null, tableName: table?.name ?? null,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

// ─────────── Reading values ───────────
const pick = (values: Record<string, unknown>, ...patterns: RegExp[]) => {
  for (const re of patterns) {
    const key = Object.keys(values).find((k) => re.test(k.trim()));
    if (key) return values[key];
  }
  return undefined;
};
const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v.replace(/^```|```$/g, "").trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return text(o.name ?? o.url ?? o.value ?? "");
  }
  return "";
};
const person = (v: unknown): { name: string; email: string | null } | null => {
  const o = (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | string | undefined;
  if (!o) return null;
  if (typeof o === "string") return o.trim() ? { name: o.trim(), email: null } : null;
  const name = text(o.name);
  return name ? { name, email: typeof o.email === "string" ? o.email : null } : null;
};
const images = (v: unknown): { url: string; name?: string }[] =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .map((x) => (typeof x === "string" ? { url: x } : { url: text((x as Record<string, unknown>).url), name: text((x as Record<string, unknown>).name) || undefined }))
    .filter((x) => /^https:\/\//.test(x.url));
const link = (v: unknown): string | null => {
  const o = Array.isArray(v) ? v[0] : v;
  const u = typeof o === "string" ? o : o && typeof o === "object" ? text((o as Record<string, unknown>).url) : "";
  return /^https:\/\//.test(u) ? u : null;
};
const dueDate = (v: unknown): string | null => {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const duration = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return `${Math.round(v * 86400)}s`; // Coda durations as numbers are days
  const s = text(v);
  const secs = seconds(s);
  return secs ? `${Math.round(secs)}s` : s || null;
};

// ─────────── Markdown of the Shot Tracker page: the callout on top ───────────
export function parseTrackerHeader(md: string) {
  const top = md.split("\n");
  const cut = top.findIndex((l) => /^\s*\|/.test(l));
  // The callout comes as a quote block: drop one level of ">" so blank quote lines read as blank lines.
  const lines = (cut >= 0 ? top.slice(0, cut) : top).map((l) => l.replace(/\s+$/, "").replace(/^>\s?/, ""));
  let codaCount: string | null = null;
  let storyline: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const plain = l.replace(/[#*>_]/g, "").trim();
    if (!codaCount && /\bslates?\b.*\bshots?\b/i.test(plain)) { codaCount = plain; continue; }
    if (/^storyline:?$/i.test(plain)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const para: string[] = [];
      while (j < lines.length && lines[j].trim()) para.push(lines[j++]);
      storyline = para.join("\n").trim() || null;
      i = j - 1;
      continue;
    }
    rest.push(l);
  }
  const header = rest.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { codaCount, storyline, header: header || null };
}

// ─────────── Markdown of the Visual Guides page ───────────
export type GuideItem = { sequence: string; kind: string; title: string; images: { url: string; name?: string }[]; notes: string };
export function parseGuide(md: string): GuideItem[] {
  const items: GuideItem[] = [];
  let seq = "General", skip = false, cur: GuideItem | null = null;
  const clean = (s: string) => s.replace(/\*\*|__/g, "").replace(/\\([_*\[\]()#.-])/g, "$1").replace(/\s+/g, " ").trim();
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h && h[1].length <= 2) {
      const t = clean(h[2]);
      skip = /null image/i.test(t);
      if (!skip) { seq = t; cur = null; }
      continue;
    }
    if (skip) continue;
    if (h) {
      const t = clean(h[2]);
      const parts = t.split(/\s*·\s*/);
      const isKind = parts.length > 1 && /^[A-Z][A-Z /&]+$/.test(parts[0]);
      cur = { sequence: seq, kind: isKind ? parts[0] : "", title: isKind ? parts.slice(1).join(" · ") : t, images: [], notes: "" };
      items.push(cur);
      continue;
    }
    const imgs = [...l.matchAll(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g)];
    if (imgs.length) {
      if (!cur) { cur = { sequence: seq, kind: "", title: "", images: [], notes: "" }; items.push(cur); }
      for (const m of imgs) cur.images.push({ url: m[2], name: clean(m[1]) || undefined });
      const restText = l.replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim();
      if (restText) cur.notes = [cur.notes, restText].filter(Boolean).join("\n");
      continue;
    }
    if (!cur) { cur = { sequence: seq, kind: "", title: "", images: [], notes: "" }; items.push(cur); }
    cur.notes = [cur.notes, l].filter(Boolean).join("\n");
  }
  return items.filter((i) => i.images.length || i.title || i.notes);
}

// ─────────── PEKS project setup ───────────
// Coda numbering. 8 (Elves Approved) was dropped on purpose; the other numbers stay the ones the team knows.
const PEKS_STATUSES: [number, string, string, boolean, boolean, boolean][] = [
  // code, name, color, artist may set, counts as done, not a shot
  [1, "1. Not Started", "#9a93a0", true, false, false],
  [2, "2. In Progress", "#3d7bd9", true, false, false],
  [3, "3. Ready for Internal Approval", "#8b4fd6", true, false, false],
  [4, "4. Adjustments Needed", "#d9473f", false, false, false],
  [5, "5. Approved by Igor", "#169c8c", false, false, false],
  [6, "6. Ready for Delivery", "#2f9a56", false, true, false],
  [7, "7. Delivered, used in Fine Cut", "#1d6b3c", false, true, false],
  [9, "9. ON HOLD", "#d79a17", false, false, false],
  [10, "10. Cancelled", "#56505c", false, false, true],
  [11, "11. Needs internal discussion", "#d14d94", false, false, false],
  [12, "12. Needs cleaning", "#e07a2c", false, false, false],
  [13, "13. Delivered, used in Rough Cut", "#1b8fc4", false, true, false],
  [14, "14. Repeat shot / Alt", "#8a7f6c", false, false, true],
];

export async function ensurePeks(): Promise<string> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    let pid = (await c.query("select id from projects where slug='peks'")).rows[0]?.id as string | undefined;
    if (!pid) {
      pid = (await c.query(
        "insert into projects (name, slug, description, uses_episodes) values ('PEKS','peks','Prosecuting Evil with Kelly Siegler, season 3',true) returning id")).rows[0].id as string;
    }
    for (const [code, name, color, artist, done, notShot] of PEKS_STATUSES) {
      const existing = (await c.query("select id from statuses where project_id=$1 and (code=$2 or name=$3 or name=$4) limit 1",
        [pid, code, name, name.replace(/^\d+\.\s*/, "")])).rows[0]?.id as string | undefined;
      const sid = existing
        ? (await c.query(
            `update statuses set name=$2, color=$3, code=$4, sort_order=$4, counts_as_done=$5, not_a_shot=$6, back_to_artist=$7, is_initial=($4=1)
              where id=$1 returning id`, [existing, name, color, code, done, notShot, code === 4])).rows[0].id
        : (await c.query(
            `insert into statuses (project_id, name, color, code, sort_order, counts_as_done, not_a_shot, back_to_artist, is_initial)
             values ($1,$2,$3,$4,$4,$5,$6,$7,($4=1)) returning id`, [pid, name, color, code, done, notShot, code === 4])).rows[0].id;
      await c.query("delete from status_permissions where status_id=$1 and user_type='artist'", [sid]);
      if (artist) await c.query("insert into status_permissions values ($1,'artist') on conflict do nothing", [sid]);
    }
    for (const [i, [title, kind]] of [["Shot Tracker", "shot_tracker"], ["Visual Guides", "visual_guide"]].entries()) {
      await c.query(
        `insert into episode_page_templates (project_id, title, kind, visible_to, sort_order) values ($1,$2,$3,'{artist,client}',$4)
         on conflict (project_id, title) do nothing`, [pid, title, kind, i + 1]);
    }
    await c.query("commit");
    return pid;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

// ─────────── One episode ───────────
export type EpisodeReport = {
  code: string; title: string | null; rows: number; slates: number; shots: number; duration: string;
  codaCount: string | null; artistsWithoutAccount: string[]; unknownStatuses: Record<string, number>;
  guideItems: number; guideImages: number; boards: number; producerNotes: number;
  skippedEditedHere: number; active: boolean; written: boolean; problems: string[];
};

export async function importEpisode(ep: FoundEpisode, apply: boolean): Promise<EpisodeReport> {
  const doc = DOC();
  const problems: string[] = [];
  if (!ep.tableId) problems.push("Shot Tracker table not found in this doc (it may be embedded from another doc).");

  const rows = ep.tableId
    ? await all<CodaRow>(`/docs/${doc}/tables/${encodeURIComponent(ep.tableId)}/rows?useColumnNames=true&valueFormat=rich&sortBy=natural&limit=500`)
    : [];
  const header = ep.trackerPageId ? parseTrackerHeader(await exportPageMarkdown(ep.trackerPageId).catch((e) => { problems.push(`Header: ${e.message}`); return ""; })) : { codaCount: null, storyline: null, header: null };
  const guide = ep.guidePageId ? parseGuide(await exportPageMarkdown(ep.guidePageId).catch((e) => { problems.push(`Visual Guides: ${e.message}`); return ""; })) : [];
  if (!ep.guidePageId) problems.push("Visual Guides page not found.");

  const pid = await ensurePeks();
  const statuses = (await pool.query("select id, code, name, counts_as_done, not_a_shot from statuses where project_id=$1", [pid])).rows as
    { id: string; code: number; name: string; counts_as_done: boolean; not_a_shot: boolean }[];
  const profiles = (await pool.query("select id, lower(email) as email, lower(full_name) as name from profiles")).rows as { id: string; email: string; name: string }[];

  const unknownStatuses: Record<string, number> = {};
  const noAccount = new Set<string>();
  const shots = rows
    .map((r, i) => {
      const v = r.values;
      // Some trackers share one table across episodes: keep only this episode's rows.
      const epNum = text(pick(v, /^episode$/i));
      if (epNum && epNum.replace(/\D/g, "") && epNum.replace(/\D/g, "") !== ep.code) return null;
      const st = text(pick(v, /^status$/i));
      const code = parseInt(st, 10);
      const status = statuses.find((s) => s.code === code) ?? null;
      if (st && !status) unknownStatuses[st] = (unknownStatuses[st] ?? 0) + 1;
      const who = person(pick(v, /^artist$/i));
      const prof = who && profiles.find((p) => (who.email && p.email === who.email.toLowerCase()) || p.name === who.name.toLowerCase());
      if (who && !prof) noAccount.add(who.name);
      return {
        ref: `coda:${doc}:${r.id}`, sort: i + 1,
        shot_num: text(pick(v, /^shot\s*#$/i, /^shot$/i)),
        act: text(pick(v, /^act$/i)) || null,
        sequence: text(pick(v, /^sequence$/i, /^seq/i, /^scene$/i)) || null,
        slate: text(pick(v, /^slate$/i)) || null,
        timecodes: text(pick(v, /timecode/i)) || null,
        duration: duration(pick(v, /duration/i)),
        brief: text(pick(v, /^brief$/i)),
        boards: images(pick(v, /^boards?/i, /storyboard/i)),
        artist_id: prof?.id ?? null, artist_name: who?.name ?? null, artist_email: who?.email ?? null,
        status_id: status?.id ?? null, status,
        due_date: dueDate(pick(v, /due/i)),
        drive_url: link(pick(v, /drive/i)),
        director_notes: text(pick(v, /director/i)),
        showrunner_notes: text(pick(v, /showrunner/i)),
        elves_notes: text(pick(v, /^elves/i)),
        producer: text(pick(v, /producer/i)),
        noteAt: r.updatedAt ?? r.createdAt ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  // Same counting rule as the system (and the Coda callout)
  const per = new Map<string, number>();
  for (const s of shots) if (s.slate && !per.has(s.slate)) per.set(s.slate, seconds(s.duration));
  const total = [...per.values()].reduce((a, b) => a + b, 0);
  const counted = shots.filter((s) => !s.status?.not_a_shot).length;
  const pending = shots.some((s) => s.status && !s.status.counts_as_done && !s.status.not_a_shot && s.status.code !== 9);

  const report: EpisodeReport = {
    code: ep.code, title: ep.title, rows: shots.length, slates: per.size, shots: counted,
    duration: `${Math.floor(total / 60)}m ${Math.round(total % 60)}s`, codaCount: header.codaCount,
    artistsWithoutAccount: [...noAccount].sort(), unknownStatuses,
    guideItems: guide.length, guideImages: guide.reduce((a, g) => a + g.images.length, 0),
    boards: shots.reduce((a, s) => a + s.boards.length, 0), producerNotes: shots.filter((s) => s.producer).length,
    skippedEditedHere: 0, active: pending, written: false, problems,
  };
  if (!apply) return report;

  const c = await pool.connect();
  try {
    await c.query("begin");
    const epRef = `coda:${doc}:${ep.pageId}`;
    let eid = (await c.query("select id from episodes where source_ref=$1 or (project_id=$2 and code=$3) limit 1", [epRef, pid, ep.code])).rows[0]?.id as string | undefined;
    if (eid) {
      await c.query("update episodes set title=$2, storyline=$3, header_md=$4, source_ref=$5 where id=$1",
        [eid, ep.title, header.storyline, header.header, epRef]);
    } else {
      eid = (await c.query(
        "insert into episodes (project_id, code, title, is_active, storyline, header_md, source_ref) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [pid, ep.code, ep.title, pending, header.storyline, header.header, epRef])).rows[0].id as string;
    }
    for (const s of shots) {
      const r = await c.query(
        `insert into shots (project_id, episode_id, shot_num, act, sequence, slate, timecodes, duration, brief, boards,
                            artist_id, artist_name, artist_email, status_id, due_date, drive_url, director_notes,
                            showrunner_notes, elves_notes, sort_order, source_ref)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         on conflict (source_ref) do update set
           shot_num=excluded.shot_num, act=excluded.act, sequence=excluded.sequence, slate=excluded.slate,
           timecodes=excluded.timecodes, duration=excluded.duration, brief=excluded.brief, boards=excluded.boards,
           artist_id=coalesce(excluded.artist_id, shots.artist_id), artist_name=excluded.artist_name, artist_email=excluded.artist_email,
           status_id=excluded.status_id, due_date=excluded.due_date, drive_url=excluded.drive_url,
           director_notes=excluded.director_notes, showrunner_notes=excluded.showrunner_notes, elves_notes=excluded.elves_notes,
           sort_order=excluded.sort_order
         where not shots.edited_here
         returning id`,
        [pid, eid, s.shot_num, s.act, s.sequence, s.slate, s.timecodes, s.duration, s.brief, JSON.stringify(s.boards),
         s.artist_id, s.artist_name, s.artist_email, s.status_id, s.due_date, s.drive_url, s.director_notes,
         s.showrunner_notes, s.elves_notes, s.sort, s.ref]);
      const shotId = r.rows[0]?.id as string | undefined;
      if (!shotId) { report.skippedEditedHere++; continue; }
      if (s.producer) {
        await c.query(
          `insert into shot_notes (shot_id, author_name, body, created_at, source_ref) values ($1,'Regis',$2,coalesce($3::timestamptz, now()),$4)
           on conflict (source_ref) do update set body=excluded.body`,
          [shotId, s.producer, s.noteAt, `${s.ref}:producer`]);
      }
    }
    await c.query("delete from guide_items where episode_id=$1 and source_ref like 'coda:%'", [eid]);
    for (const [i, g] of guide.entries()) {
      await c.query(
        `insert into guide_items (project_id, episode_id, sequence, kind, title, images, notes, sort_order, source_ref)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [pid, eid, g.sequence, g.kind, g.title, JSON.stringify(g.images), g.notes, i + 1, `coda:${doc}:${ep.guidePageId}:${i + 1}`]);
    }
    await c.query("commit");
    report.written = true;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  return report;
}
