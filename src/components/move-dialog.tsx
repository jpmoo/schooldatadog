"use client";

import { Icon, type IconName } from "@/components/icon";

/**
 * A three-way "save before moving?" challenge shown when sending the current
 * sheet/graph to the other tool. Yes (save, then move), No (move without
 * saving), Cancel.
 */
export function MoveDialog({
  title,
  body,
  destinationIcon,
  onSaveAndMove,
  onMoveWithoutSaving,
  onCancel,
}: {
  title: string;
  body: string;
  destinationIcon: IconName;
  onSaveAndMove: () => void;
  onMoveWithoutSaving: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{body}</p>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Icon name="no" className="h-4 w-4" />
            Cancel
          </button>
          <button
            onClick={onMoveWithoutSaving}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Icon name={destinationIcon} className="h-4 w-4" />
            Move without saving
          </button>
          <button
            onClick={onSaveAndMove}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            <Icon name="saveViewOrGroup" className="h-4 w-4" />
            Save, then move
          </button>
        </div>
      </div>
    </div>
  );
}
