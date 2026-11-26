"use client";
import { useTransition } from "react";
import { setStatus } from "./actions";

type Opt = { id: string; name: string; color: string };

// Status picker that saves as soon as it changes.
export function StatusSelect({ shot, current, options, label }: { shot: string; current: string | null; options: Opt[]; label: string }) {
  const [pending, start] = useTransition();
  const cur = options.find((o) => o.id === current);
  return (
    <select
      className="st"
      style={{ ["--c" as string]: cur?.color ?? "#999" }}
      defaultValue={current ?? ""}
      disabled={pending}
      aria-label={label}
      onChange={(e) => {
        const fd = new FormData();
        fd.set("shot", shot);
        fd.set("status", e.target.value);
        start(async () => {
          try { await setStatus(fd); } catch { alertBack(e.target, current); }
        });
      }}
    >
      {!cur && <option value="" disabled>No status</option>}
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

function alertBack(el: HTMLSelectElement, current: string | null) {
  el.value = current ?? "";
  el.setCustomValidity("This change was not allowed.");
  el.reportValidity();
  setTimeout(() => el.setCustomValidity(""), 3000);
}
