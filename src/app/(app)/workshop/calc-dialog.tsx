"use client";

import { useMemo, useState } from "react";
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
        <input
          type="number"
          min={0}
          step="0.5"
          value={weight}
          onChange={(e) => onWeight(Number(e.target.value))}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          title="Weight"
        />
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
  const isSimilarity = calcType === "similarity";
  const showWeight = calcType === "rank" || isSimilarity;
  const enoughCols = selectedInOrder.length >= (isChange ? 2 : 1);
  const canSubmit =
    enoughCols && name.trim().length > 0 && (!isSimilarity || refEntityId != null);

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
            Columns {showWeight && <span className="text-slate-400">(and weights)</span>}
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
                          weight={weights[s.id] ?? 1}
                          onWeight={(v) => setWeights((w) => ({ ...w, [s.id]: v }))}
                          onRemove={() => toggle(s.id, false)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
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
