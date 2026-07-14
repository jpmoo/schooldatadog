"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A compact multi-select filter shown as a button that opens a popover with a
 * search box, Select-all / Clear actions, and a checkbox per option — mirroring
 * the entity picker. An EMPTY selection means "no filter" (all), so the caller
 * treats `[]` as "everything".
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  allLabel = "All",
  pluralNoun = "selected",
  searchPlaceholder = "Search…",
  className = "",
  title,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  pluralNoun?: string;
  searchPlaceholder?: string;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const sel = useMemo(() => new Set(selected), [selected]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options;

  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0]
        : `${selected.length} ${pluralNoun}`;

  const toggle = (o: string) => {
    const next = new Set(sel);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onChange([...next]);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={className} title={title}>
        {label}
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-64 max-w-[80vw] rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <div className="mt-1 flex gap-2 px-1 py-1 text-xs">
            <button onClick={() => onChange([...options])} className="text-indigo-600 hover:underline">
              Select all
            </button>
            <button onClick={() => onChange([])} className="text-indigo-600 hover:underline">
              Clear
            </button>
            <span className="ml-auto text-slate-400">{shown.length}</span>
          </div>
          <div className="max-h-56 min-h-0 overflow-y-auto">
            {shown.map((o) => (
              <label key={o} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                <input type="checkbox" checked={sel.has(o)} onChange={() => toggle(o)} />
                <span className="truncate text-slate-700 dark:text-slate-200">{o}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">No matches</p>}
          </div>
        </div>
      )}
    </div>
  );
}
