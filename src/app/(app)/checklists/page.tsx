import { requireMe } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { phraseOfTheDay, type Rule } from "@/lib/checklist";
import { SubmitButton } from "@/components/submit-button";
import { addRule, deleteRule, saveRule } from "./actions";

// Everyone sees the rules of their projects. Admins add, edit and remove them.
export default async function Checklists({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireMe();
  const sp = await searchParams;
  const admin = me.user_type === "admin";
  const { projects, rules } = await asUser(me.id, async (db) => ({
    projects: (await db.query<{ id: string; name: string }>("select id, name from projects where not is_archived order by name")).rows,
    rules: (await db.query<Rule>("select id, project_id, rule, phrases from checklist_rules order by sort_order, created_at")).rows,
  }));
  const shown = sp.project ? projects.filter((p) => p.id === sp.project) : projects;

  const section = (key: string | null, title: string) => {
    const list = rules.filter((r) => r.project_id === key);
    return (
      <section key={key ?? "universal"} className="card p-5">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <ol className="mt-3 grid gap-3 list-decimal pl-5">
          {list.map((r) => (
            <li key={r.id} className="border-b border-line pb-3">
              {admin ? (
                <details>
                  <summary className="cursor-pointer"><b>{r.rule}</b><span className="block text-xs text-muted">{r.phrases.join(" · ") || "No phrase yet: the rule itself shows as the phrase of the day."}</span></summary>
                  <form action={saveRule} className="grid gap-2 mt-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="rule" defaultValue={r.rule} className="input" aria-label="Rule" required />
                    <textarea name="phrases" defaultValue={r.phrases.join("\n")} rows={3} className="input" aria-label="Phrases, one per line" />
                    <div className="flex gap-2"><SubmitButton className="btn btn-sm">Save</SubmitButton><SubmitButton formAction={deleteRule} className="btn btn-danger btn-sm">Remove</SubmitButton></div>
                  </form>
                </details>
              ) : (
                <><b>{r.rule}</b>{r.phrases[0] && <span className="block text-sm text-muted">“{r.phrases[0]}”</span>}</>
              )}
            </li>
          ))}
          {!list.length && <li className="list-none -ml-5 text-sm text-muted">No rules yet.</li>}
        </ol>
        {admin && (
          <form action={addRule} className="grid gap-2 mt-3 sm:grid-cols-[1fr_1fr_auto] items-start">
            <input type="hidden" name="project" value={key ?? ""} />
            <input name="rule" required placeholder="New rule" className="input" aria-label={`New rule for ${title}`} />
            <textarea name="phrases" rows={1} placeholder="Phrases in Portuguese, one per line (optional)" className="input" aria-label="Phrases" />
            <SubmitButton className="btn btn-ghost">Add rule</SubmitButton>
          </form>
        )}
      </section>
    );
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-4xl font-bold">Checklists</h1>
      <p className="text-muted mt-1 mb-5">Rules every artist must follow. Every day, each artist&apos;s Home shows one rule drawn at random as a pun, a funny poetic line or a Brazilian saying, in Portuguese.</p>
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))] mb-5">
        {shown.map((p) => { const d = phraseOfTheDay(rules, me.id, p.id); return d && (
          <div key={p.id} className="card p-4"><span className="chip">{p.name} · today for {me.full_name.split(" ")[0]}</span><p className="font-display text-lg mt-2">“{d.phrase}”</p></div>); })}
      </div>
      <div className="grid gap-4">
        {section(null, "Universal rules (every project)")}
        {shown.map((p) => section(p.id, p.name))}
      </div>
    </div>
  );
}
