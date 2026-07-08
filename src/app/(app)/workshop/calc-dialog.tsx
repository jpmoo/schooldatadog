"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CALC_LABELS, type CalcType } from "./columns";

export type CalcConfig = {
  calcType: CalcType;
  name: string;
  sourceIds: string[];
  weights: Record<string, number>;
  asPercent: boolean;
  refEntityId: number | null;
};

type SourceOption = { id: string; label: string };
type EntityOption = { id: number; name: string };

const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/**
 * Split `total` into `n` whole numbers as evenly as possible (largest-remainder
 * method): every part is floor(total/n), and the leftover units are handed out
 * one each to the first few — so the parts always sum to exactly `total`.
 */
function evenSplit(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

function SortableSource({
  s,
  showWeight,
  weight,
  onWeight,
  onRemove,
}: {
  s: SourceOption;
  showWeight: boolean;
  weight: number;
  onWeight: (v: number) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950 ${
        isDragging ? "opacity-60 shadow" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-slate-400 active:cursor-grabbing"
        title="Drag to reorder"
      >
        ⠿
      </button>
      <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{s.label}</span>
      {showWeight && (
        <span className="flex items-center gap-0.5">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={weight}
            onChange={(e) => onWeight(Number(e.target.value))}
            className="w-14 rounded border border-slate-300 px-2 py-1 text-right text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            title="Weight (%)"
          />
          <span className="text-xs text-slate-400">%</span>
        </span>
      )}
      <button onClick={onRemove} className="text-slate-300 hover:text-red-500" title="Remove">
        ✕
      </button>
    </div>
  );
}

export function CalcDialog({
  sources,
  entities,
  defaultRefId,
  initial,
  onReorderSources,
  onConfirm,
  onClose,
}: {
  sources: SourceOption[];
  entities: EntityOption[];
  defaultRefId: number | null;
  initial?: CalcConfig;
  /** Reorder the underlying columns so the sheet reflects the dialog order. */
  onReorderSources: (orderedIds: string[]) => void;
  onConfirm: (config: CalcConfig) => void;
  onClose: () => void;
}) {
  const [calcType, setCalcType] = useState<CalcType>(initial?.calcType ?? "avg");
  const [selected, setSelected] = useState<Set<string>>(new Set(initial?.sourceIds ?? []));
  const [weights, setWeights] = useState<Record<string, number>>(initial?.weights ?? {});
  const [name, setName] = useState(initial?.name ?? "");
  const [asPercent, setAsPercent] = useState(initial?.asPercent ?? false);
  const [refEntityId, setRefEntityId] = useState<number | null>(
    initial?.refEntityId ?? defaultRefId ?? null,
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Selected columns, in the sheet's column order (source of truth for order).
  const selectedInOrder = useMemo(
    () => sources.filter((s) => selected.has(s.id)),
    [sources, selected],
  );
  const available = sources.filter((s) => !selected.has(s.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const isSimilarity = calcType === "similarity";
  const showWeight = calcType === "rank" || isSimilarity;

  // Seed an even split the first time a field is weighted, and give any brand-new
  // column a default share — but never touch weights the user has already set
  // (they balance to 100 themselves, watching the running total).
  const idsKey = selectedInOrder.map((s) => s.id).join(",");
  useEffect(() => {
    if (!showWeight) return;
    const ids = selectedInOrder.map((s) => s.id);
    if (ids.length === 0) return;
    setWeights((prev) => {
      const anyExisting = ids.some((id) => typeof prev[id] === "number");
      if (!anyExisting) {
        const split = evenSplit(100, ids.length);
        const next: Record<string, number> = {};
        ids.forEach((id, i) => (next[id] = split[i]));
        return next;
      }
      const share = Math.round(100 / ids.length);
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        if (typeof next[id] !== "number") {
          next[id] = share;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWeight, idsKey]);

  // Set one column's weight only — the others are left exactly as the user set
  // them (the x/100 total shows whether they still add up).
  function setWeight(id: string, value: number) {
    setWeights((w) => ({ ...w, [id]: clampPct(value) }));
  }

  function distributeEvenly() {
    const ids = selectedInOrder.map((s) => s.id);
    const split = evenSplit(100, ids.length);
    const next: Record<string, number> = {};
    ids.forEach((id, i) => (next[id] = split[i]));
    setWeights(next);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = selectedInOrder.map((s) => s.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorderSources(arrayMove(ids, from, to)); // updates the sheet + re-orders `sources`
  }

  const isChange = calcType === "change" || calcType === "avgchange";
  const enoughCols = selectedInOrder.length >= (isChange ? 2 : 1);
  const weightSum = selectedInOrder.reduce((a, s) => a + (weights[s.id] ?? 0), 0);
  const canSubmit =
    enoughCols &&
    name.trim().length > 0 &&
    (!isSimilarity || refEntityId != null) &&
    (!showWeight || weightSum === 100); // weighted fields must total 100%

  const inputCls =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {initial ? "Edit calculated field" : "New calculated field"}
        </h2>

        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">Calculation</span>
          <select value={calcType} onChange={(e) => setCalcType(e.target.value as CalcType)} className={inputCls}>
            {(Object.keys(CALC_LABELS) as CalcType[]).map((t) => (
              <option key={t} value={t}>
                {CALC_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={CALC_LABELS[calcType].split(" (")[0]}
            className={inputCls}
          />
        </label>

        {isSimilarity && (
          <label className="mt-4 flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Compare everyone to</span>
            <select
              value={refEntityId ?? ""}
              onChange={(e) => setRefEntityId(e.target.value ? Number(e.target.value) : null)}
              className={inputCls}
            >
              <option value="">Choose a district…</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400">
              Each row scores 0–100% by how close it is to this one across the weighted columns
              (values are standardized first, so different scales are comparable).
            </span>
          </label>
        )}

        {isChange && (
          <div className="mt-4 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Show as</span>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={!asPercent} onChange={() => setAsPercent(false)} />
                Raw number
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={asPercent} onChange={() => setAsPercent(true)} />
                Percentage change
              </label>
            </div>
          </div>
        )}

        <div className="mt-4 text-sm">
          <p className="mb-2 font-medium text-slate-700 dark:text-slate-200">
            Columns {showWeight && <span className="text-slate-400">(weights total 100%)</span>}
          </p>
          {sources.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Add some data columns first, then build a calculated field from them.
            </p>
          ) : (
            <>
              {selectedInOrder.length > 0 && (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                >
                  <SortableContext
                    items={selectedInOrder.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1">
                      {selectedInOrder.map((s) => (
                        <SortableSource
                          key={s.id}
                          s={s}
                          showWeight={showWeight}
                          weight={weights[s.id] ?? 0}
                          onWeight={(v) => setWeight(s.id, v)}
                          onRemove={() => toggle(s.id, false)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              {showWeight && selectedInOrder.length > 0 && (
                <div className="mt-1 flex items-start justify-between gap-2">
                  <p className="text-xs text-slate-400">
                    Set each column&apos;s share — adjust them so the total adds up to 100.
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`text-xs font-medium tabular-nums ${
                        weightSum === 100 ? "text-slate-500 dark:text-slate-400" : "text-red-500"
                      }`}
                      title="Sum of weights"
                    >
                      {weightSum}/100
                    </span>
                    {selectedInOrder.length > 1 && (
                      <button
                        onClick={distributeEvenly}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Distribute evenly
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isChange && (
                <p className="mt-1 text-xs text-slate-400">
                  Evaluated first → last in the order above — drag the handles to reorder (the sheet
                  updates too).
                </p>
              )}

              {available.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Add columns</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                    {available.map((s) => (
                      <label key={s.id} className="flex items-center gap-2">
                        <input type="checkbox" checked={false} onChange={() => toggle(s.id, true)} />
                        <span className="text-slate-600 dark:text-slate-300">{s.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
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
                name: name.trim(),
                sourceIds: selectedInOrder.map((s) => s.id),
                weights,
                asPercent: isChange ? asPercent : false,
                refEntityId: isSimilarity ? refEntityId : null,
              })
            }
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {initial ? "Save" : "Add field"}
          </button>
        </div>
      </div>
    </div>
  );
}
