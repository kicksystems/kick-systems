import { timingSafeEqual } from "node:crypto";
import { exportPageMarkdown, findEpisodes, htmlToMd, importEpisode } from "@/lib/coda";

// Import from Superhuman Docs (Coda). Protected by IMPORT_SECRET (a Vercel environment variable).
//   ?key=…                         list the episodes found
//   ?key=…&episode=314             dry run: what would be imported, with the counts to compare with Coda
//   ?key=…&episode=314&apply=1     write it
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function allowed(key: string | null) {
  const secret = process.env.IMPORT_SECRET;
  if (!secret || !key) return false;
  const a = Buffer.from(secret), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!allowed(url.searchParams.get("key"))) return Response.json({ error: "Not allowed." }, { status: 403 });
  try {
    const episodes = await findEpisodes();
    const code = url.searchParams.get("episode");
    if (!code) return Response.json({ episodes });
    const ep = episodes.find((e) => e.code === code);
    if (!ep) return Response.json({ error: `Episode ${code} not found.` }, { status: 404 });
    if (url.searchParams.get("peek") === "guide" && ep.guidePageId) {
      const md = htmlToMd(await exportPageMarkdown(ep.guidePageId, "html"));
      const at = Math.max(0, md.search(/SEQUENCE/i));
      return Response.json({ length: md.length, sample: md.slice(at, at + 1500) });
    }
    const report = await importEpisode(ep, url.searchParams.get("apply") === "1");
    return Response.json({ report });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
