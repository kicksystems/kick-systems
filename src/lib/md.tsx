import { Fragment, type ReactNode } from "react";

// A very small Markdown reader for text imported from Coda (episode callouts, notes).
// It only builds React elements (no raw HTML), so imported text can never inject markup.
// Supported: headings (#), quotes (>), **bold**, *italic*, [links](https://...), bare https:// links, line breaks.

const safeUrl = (u: string) => (/^https:\/\//i.test(u) ? u : null);

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https:\/\/[^\s<>()]+)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] && m[2]) {
      const url = safeUrl(m[2]);
      out.push(url ? <a key={k} href={url} target="_blank" rel="noreferrer">{m[1]}</a> : m[1]);
    } else if (m[3]) {
      out.push(<a key={k} href={m[3]} target="_blank" rel="noreferrer">{m[3]}</a>);
    } else if (m[4]) out.push(<strong key={k}>{inline(m[4], k)}</strong>);
    else if (m[5]) out.push(<em key={k}>{inline(m[5], k)}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  if (!text?.trim()) return null;
  const blocks = text.replace(/\r/g, "").replace(/\\([_*\[\]()#>-])/g, "$1").split(/\n{2,}/);
  return (
    <div className={`md ${className}`}>
      {blocks.map((b, bi) => {
        const t = b.trim();
        if (!t) return null;
        const h = /^(#{1,6})\s+([\s\S]*)$/.exec(t);
        if (h) {
          const lvl = h[1].length;
          const cls = lvl <= 2 ? "font-display text-lg font-semibold mt-2" : "font-display font-semibold mt-2";
          return <p key={bi} className={cls}>{inline(h[2].replace(/\*\*/g, ""), `h${bi}`)}</p>;
        }
        const quote = t.split("\n").every((l) => l.startsWith(">"));
        const lines = t.split("\n").map((l) => (quote ? l.replace(/^>\s?/, "") : l).replace(/\s{2,}$/, ""));
        const body = lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, `b${bi}-${li}`)}</Fragment>);
        return quote
          ? <blockquote key={bi} className="border-l-2 border-line pl-3 my-2">{body}</blockquote>
          : <p key={bi}>{body}</p>;
      })}
    </div>
  );
}
