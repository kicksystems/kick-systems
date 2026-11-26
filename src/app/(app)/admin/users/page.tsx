import { Fragment } from "react";
import { requireAdmin } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { USER_TYPES, USER_TYPE_HELP } from "@/lib/queries";
import { addPerson, resendInvite, updatePerson } from "./actions";
import { pendingInvites } from "@/lib/auth-admin";
import { SubmitButton } from "@/components/submit-button";

type Person = {
  id: string; full_name: string; email: string; user_type: string;
  discord_user_id: string | null; is_active: boolean; project_ids: string[];
};

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const pending = await pendingInvites();
  const { people, projects } = await asUser(me.id, async (db) => ({
    people: (await db.query<Person>(
      `select p.*, coalesce(array_agg(m.project_id) filter (where m.project_id is not null), '{}') as project_ids
         from profiles p left join project_members m on m.user_id = p.id
        group by p.id order by p.is_active desc, p.user_type, p.full_name`)).rows,
    projects: (await db.query("select id, name from projects where not is_archived order by name")).rows as { id: string; name: string }[],
  }));

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-3xl font-bold">People</h1>
      <p className="text-muted mb-5">Who logs in, what type of user they are and which projects they belong to.</p>
      {(sp.added || sp.saved || sp.invited) && <p className="card px-4 py-2 mb-4 text-sm text-ok">{sp.added ? "Person added. They get an e-mail with a link to choose their password." : sp.invited ? "Invitation sent again." : "Saved."}</p>}
      <p className="text-sm text-muted mb-5">How passwords work: nobody types a password for someone else. A new person gets an e-mail with a link, and chooses their own password. If the e-mail got lost or the link expired, open the person and use “Send the invitation again”.</p>

      <details className="card p-5 mb-6">
        <summary className="cursor-pointer font-semibold">Add a person</summary>
        <PersonForm action={addPerson} projects={projects} submit="Add person" />
      </details>

      <section className="card divide-y divide-line">
        {people.map((p) => (
          <details key={p.id} className="p-4">
            <summary className="cursor-pointer list-none flex flex-wrap items-center gap-3">
              <span className={`font-semibold ${p.is_active ? "" : "line-through text-muted"}`}>{p.full_name}</span>
              <span className="chip">{p.user_type}</span>
              <span className="text-xs text-muted">{p.email}</span>
              {pending.has(p.id) && <span className="chip !bg-[#fdf0d5] !text-[#8a5a00]">Waiting for password</span>}
              <span className="text-xs text-muted ml-auto">
                {p.project_ids.map((id) => projects.find((x) => x.id === id)?.name).filter(Boolean).join(", ") || "No projects"}
              </span>
            </summary>
            <PersonForm action={updatePerson} projects={projects} person={p} submit="Save" isSelf={p.id === me.id} />
            {p.id !== me.id && (
              <form action={resendInvite} className="mt-3">
                <input type="hidden" name="id" value={p.id} />
                <SubmitButton className="btn btn-ghost btn-sm">{pending.has(p.id) ? "Send the invitation again" : "Send a link to change the password"}</SubmitButton>
              </form>
            )}
          </details>
        ))}
      </section>

      <section className="mt-6 text-sm">
        <h2 className="font-semibold mb-2">User types</h2>
        <dl className="grid sm:grid-cols-[110px_1fr] gap-x-4 gap-y-1">
          {USER_TYPES.map((t) => (<Fragment key={t}><dt className="font-semibold capitalize">{t}</dt><dd className="text-muted">{USER_TYPE_HELP[t]}</dd></Fragment>))}
        </dl>
      </section>
    </div>
  );
}

function PersonForm({ action, projects, person, submit, isSelf = false }: {
  action: (fd: FormData) => Promise<void>; projects: { id: string; name: string }[];
  person?: Person; submit: string; isSelf?: boolean;
}) {
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
      {person && <input type="hidden" name="id" value={person.id} />}
      <label><span className="label">Full name</span>
        <input className="input mt-1" name="full_name" defaultValue={person?.full_name} required /></label>
      <label><span className="label">E-mail (login)</span>
        <input className="input mt-1" name="email" type="email" defaultValue={person?.email} required readOnly={!!person}
          title={person ? "The login e-mail cannot be changed here." : undefined} /></label>
      <label><span className="label">User type</span>
        <select className="input mt-1" name="user_type" defaultValue={person?.user_type ?? "artist"} disabled={isSelf}>
          {USER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {isSelf && <input type="hidden" name="user_type" value={person!.user_type} />}
      </label>
      <label><span className="label">Discord user ID (numeric, for notifications)</span>
        <input className="input mt-1" name="discord_user_id" inputMode="numeric" defaultValue={person?.discord_user_id ?? ""} /></label>
      <fieldset className="sm:col-span-2">
        <legend className="label mb-1">Projects</legend>
        <div className="flex flex-wrap gap-3">
          {projects.map((pr) => (
            <label key={pr.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="projects" value={pr.id} defaultChecked={person?.project_ids.includes(pr.id)} />
              {pr.name}
            </label>
          ))}
        </div>
      </fieldset>
      {person && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={person.is_active} disabled={isSelf} />
          Active (can log in)
          {isSelf && <input type="hidden" name="is_active" value="on" />}
        </label>
      )}
      <div className="sm:col-span-2"><SubmitButton className="btn">{submit}</SubmitButton></div>
    </form>
  );
}
