"use client";

import { useMemo, useState } from "react";
import { CALC_LABELS, type CalcType } from "./columns";

export type CalcConfig = {
  calcType: CalcType;
  name: string;
  sourceIds: string[];
  weights: Record<string, number>;
};

type SourceOption = { id: string; label: string };

export function CalcDialog({
  sources,
  onConfirm,
  onClose,
}: {
  sources: SourceOption[];
  onConfirm: (config: CalcConfig) => void;
  onClose: () => void;
}) {
  const [calcType, setCalcType] = useState<CalcType>("avg");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [name, setName] = useState("");

  const selectedInOrder = useMemo(
    () => sources.filter((s) => selected.has(s.id)).map((s) => s.id),
    [sources, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const defaultName = () => {
    const label = CALC_LABELS[calcType].split(" (")[0];
    return name.trim() || label;
  };

  const canSubmit =
    selectedInOrder.length >= (calcType === "change" || calcType === "avgchange" ? 2 : 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          New calculated field
        </h2>

        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">Calculation</span>
          <select
            value={calcType}
            onChange={(e) => setCalcType(e.target.value as CalcType)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {(Object.keys(CALC_LABELS) as CalcType[]).map((t) => (
              <option key={t} value={t}>
                {CALC_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Name <span className="text-slate-400">(optional)</span>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={CALC_LABELS[calcType].split(" (")[0]}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>

        <div className="mt-4 text-sm">
          <p className="mb-2 font-medium text-slate-700 dark:text-slate-200">
            Columns {calcType === "rank" && <span className="text-slate-400">(and weights)</span>}
          </p>
          {sources.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Add some data columns first, then create a calculated field from them.
            </p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="text-slate-700 dark:text-slate-200">{s.label}</span>
                  </label>
                  {calcType === "rank" && selected.has(s.id) && (
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={weights[s.id] ?? 1}
                      onChange={(e) =>
                        setWeights((w) => ({ ...w, [s.id]: Number(e.target.value) }))
                      }
                      className="w-16 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      title="Weight"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
          {(calcType === "change" || calcType === "avgchange") && (
            <p className="mt-1 text-xs text-slate-400">
              Evaluated left → right in the current column order.
            </p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() =>
              onConfirm({
                calcType,
                name: defaultName(),
                sourceIds: selectedInOrder,
                weights,
              })
            }
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            Add field
          </button>
        </div>
      </div>
    </div>
  );
}
