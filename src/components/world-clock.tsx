"use client";
import { useEffect, useState } from "react";

// World clocks on the admin Home. Each person keeps their own list in this browser.
const ZONES: [string, string][] = [
  ["America/Los_Angeles", "Los Angeles"], ["America/Denver", "Denver"], ["America/Chicago", "Chicago"],
  ["America/New_York", "New York"], ["America/Sao_Paulo", "São Paulo"], ["Europe/London", "London"],
  ["Europe/Lisbon", "Lisbon"], ["Europe/Paris", "Paris"], ["Asia/Dubai", "Dubai"], ["Asia/Tokyo", "Tokyo"],
  ["Australia/Sydney", "Sydney"],
];
const KEY = "kick-clocks";
const DEFAULT = ["America/Los_Angeles", "America/Sao_Paulo"];

function label(tz: string, at: Date) {
  const n = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  if (tz === "America/Sao_Paulo") return "BRT";
  return /^[A-Z]{2,5}$/.test(n) ? n : ZONES.find((z) => z[0] === tz)?.[1] ?? tz;
}

export function WorldClock() {
  const [list, setList] = useState<string[]>(DEFAULT);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (Array.isArray(v) && v.length) setList(v); } catch {}
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  const save = (v: string[]) => { setList(v); try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
  const at = now ?? new Date(0);

  return (
    <div className="flex flex-wrap items-center gap-2 my-3" aria-label="World clock">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-muted" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" /><path d="M2.5 12h19M12 2.5c2.6 2.8 3.9 6 3.9 9.5s-1.3 6.7-3.9 9.5c-2.6-2.8-3.9-6-3.9-9.5s1.3-6.7 3.9-9.5z" />
      </svg>
      {list.map((tz, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface pl-3 pr-1.5 py-1">
          <b className="font-display text-base tabular-nums tracking-wide">
            {now ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at) : "--:--"}
          </b>
          <select value={tz} onChange={(e) => save(list.map((x, j) => (j === i ? e.target.value : x)))}
            className="bg-transparent text-xs text-muted border-0 py-0.5" aria-label={`Time zone ${i + 1}`}>
            {ZONES.map(([z, city]) => <option key={z} value={z}>{now ? label(z, at) : ""} · {city}</option>)}
          </select>
          {i > 0 && <button type="button" onClick={() => save([list[i], ...list.filter((_, j) => j !== i)])} className="text-muted hover:text-accent text-xs px-1" aria-label="Move to the front" title="Move to the front">◀</button>}
          {list.length > 1 && <button type="button" onClick={() => save(list.filter((_, j) => j !== i))} className="text-muted hover:text-accent px-1" aria-label="Remove this clock">×</button>}
        </span>
      ))}
      <button type="button" onClick={() => save([...list, "Europe/London"])} className="w-8 h-8 rounded-full border border-dashed border-line text-muted hover:text-accent hover:border-accent" aria-label="Add a clock" title="Add a place">+</button>
    </div>
  );
}
