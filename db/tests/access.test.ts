// Access rule tests. Run against a fresh local database with the demo seed:
//   npm run db:reset && npm run test:db
import { asUser, pool } from "../../src/lib/db";

const REGIS = "00000000-0000-0000-0000-000000000001";
const SARAH_DIR = "00000000-0000-0000-0000-000000000004";
const HUGO = "00000000-0000-0000-0000-000000000011";
const CRIS = "00000000-0000-0000-0000-000000000012";
const ELVES = "00000000-0000-0000-0000-000000000021";
const MELINA = "00000000-0000-0000-0000-000000000031";
const PEKS = "10000000-0000-0000-0000-000000000001";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`);
  if (!ok) failures++;
}
async function blocked(name: string, fn: () => Promise<unknown>) {
  try {
    const r = (await fn()) as { rowCount?: number } | undefined;
    // An update/delete that RLS filters out affects 0 rows instead of raising.
    check(name, r?.rowCount === 0, `expected to be blocked, affected ${r?.rowCount}`);
  } catch {
    check(name, true);
  }
}
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

async function main() {
  // Admin creates RAPID DNA by copying PEKS, adds an episode, adds Cristianne.
  const rapid = await asUser(REGIS, async (db) => {
    const { rows } = await db.query("select public.copy_project($1,'RAPID DNA','rapid-dna') as id", [PEKS]);
    const id = rows[0].id as string;
    await db.query("insert into episodes (project_id, code) values ($1,'101')", [id]);
    await db.query("insert into project_members values ($1,$2), ($1,$3)", [id, CRIS, REGIS]);
    return id;
  });
  const rapidStatuses = await asUser(REGIS, (db) => db.query("select count(*)::int n from statuses where project_id=$1", [rapid]));
  check("copy_project copies the 13 statuses", rapidStatuses.rows[0].n === 13);
  const rapidPages = await asUser(REGIS, (db) => db.query("select count(*)::int n from pages where project_id=$1", [rapid]));
  check("copy_project copies 6 project pages + 2 episode pages", rapidPages.rows[0].n === 8, String(rapidPages.rows[0].n));

  // Projects each person sees
  const projectsOf = async (u: string) =>
    (await asUser(u, (db) => db.query("select name as title from projects"))).rows;
  check("admin sees both projects", titles(await projectsOf(REGIS)).join() === "PEKS,RAPID DNA");
  check("Hugo (artist, PEKS only) sees only PEKS", titles(await projectsOf(HUGO)).join() === "PEKS");
  check("Cristianne (artist, RAPID only) sees only RAPID DNA", titles(await projectsOf(CRIS)).join() === "RAPID DNA");
  check("Elves (client) sees only PEKS", titles(await projectsOf(ELVES)).join() === "PEKS");

  // Pages each person sees in PEKS
  const pagesOf = async (u: string) =>
    (await asUser(u, (db) =>
      db.query("select distinct title from pages where project_id=$1", [PEKS]))).rows;
  const artistPages = titles(await pagesOf(HUGO));
  check("artist sees the 6 artist pages",
    artistPages.join() === "Ferramentas e Arquivos,Guidelines de Estilo Visual,Shot Tracker,Templates for Prompting,Treinamento,Visual Guides",
    artistPages.join());
  const clientPages = titles(await pagesOf(ELVES));
  check("client sees only Shot Tracker and Visual Guides", clientPages.join() === "Shot Tracker,Visual Guides", clientPages.join());
  const obsPages = titles(await pagesOf(MELINA));
  check("observer sees everything except Reports", !obsPages.includes("Reports") && obsPages.includes("Admin notes"), obsPages.join());
  const dirPages = titles(await pagesOf(SARAH_DIR));
  check("director sees Reports and admin pages", dirPages.includes("Reports") && dirPages.includes("Admin notes"));

  // Client gets one extra page by grant
  await asUser(REGIS, (db) =>
    db.query("insert into page_grants select id, $1 from pages where project_id=$2 and title='Treinamento'", [ELVES, PEKS]));
  check("a page grant lets the client see that one page", titles(await pagesOf(ELVES)).includes("Treinamento"));

  // Writes that must be blocked
  await blocked("artist cannot rename a project", () =>
    asUser(HUGO, (db) => db.query("update projects set name='X' where id=$1", [PEKS])));
  await blocked("artist cannot change their own user type", () =>
    asUser(HUGO, (db) => db.query("update profiles set user_type='admin' where id=$1", [HUGO])));
  await blocked("artist cannot add themselves to RAPID DNA", () =>
    asUser(HUGO, (db) => db.query("insert into project_members values ($1,$2)", [rapid, HUGO])));
  await blocked("artist cannot create an episode", () =>
    asUser(HUGO, (db) => db.query("insert into episodes (project_id, code) values ($1,'999')", [PEKS])));
  await blocked("artist cannot change the workflow", () =>
    asUser(HUGO, (db) => db.query("update statuses set name='Done' where project_id=$1", [PEKS])));
  await blocked("client cannot edit a page", () =>
    asUser(ELVES, (db) => db.query("update pages set body='x' where project_id=$1", [PEKS])));
  await blocked("observer cannot edit a page", () =>
    asUser(MELINA, (db) => db.query("update pages set body='x' where project_id=$1", [PEKS])));
  await blocked("observer cannot create a project", () =>
    asUser(MELINA, (db) => db.query("insert into projects (name, slug) values ('Y','y')")));
  await blocked("director cannot create a project", () =>
    asUser(SARAH_DIR, (db) => db.query("select public.copy_project($1,'Z','z')", [PEKS])));
  await blocked("director cannot change user types", () =>
    asUser(SARAH_DIR, (db) => db.query("update profiles set user_type='admin' where id=$1", [HUGO])));
  await blocked("director cannot manage RAPID DNA (not a member)", () =>
    asUser(SARAH_DIR, (db) => db.query("update projects set description='x' where id=$1", [rapid])));
  await blocked("admin cannot demote themselves", () =>
    asUser(REGIS, (db) => db.query("update profiles set user_type='artist' where id=$1", [REGIS])));

  // Writes that must work
  const dirEp = await asUser(SARAH_DIR, (db) =>
    db.query("update episodes set is_active=false where project_id=$1 and code='312'", [PEKS]));
  check("director can close an episode in PEKS", dirEp.rowCount === 1);
  const adminUser = await asUser(REGIS, (db) =>
    db.query("update profiles set user_type='observer' where id=$1", [HUGO]));
  check("admin can change another person's type", adminUser.rowCount === 1);

  // Deactivated people lose access
  await asUser(REGIS, (db) => db.query("update profiles set is_active=false, user_type='artist' where id=$1", [HUGO]));
  check("deactivated artist sees no projects", (await projectsOf(HUGO)).length === 0);

  // Not logged in
  const anon = await asUser("00000000-0000-0000-0000-0000000000ff", (db) => db.query("select count(*)::int n from pages"));
  check("unknown user sees no pages", anon.rows[0].n === 0);

  await pool.end();
  console.log(failures ? `\n${failures} FAILED` : "\nAll access tests passed.");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
