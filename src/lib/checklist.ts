// Phrase of the day: one rule drawn per person, per project, per day (the same all day long).
export type Rule = { id: string; project_id: string | null; rule: string; phrases: string[] };

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function todayBRT() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function phraseOfTheDay(rules: Rule[], who: string, projectId: string, day = todayBRT()) {
  const pool = rules.filter((r) => r.project_id === projectId || r.project_id === null);
  if (!pool.length) return null;
  const h = hash(day + who + projectId);
  const rule = pool[h % pool.length];
  const phrase = rule.phrases.length ? rule.phrases[(h >>> 8) % rule.phrases.length] : rule.rule;
  return { rule, phrase, total: pool.length };
}
