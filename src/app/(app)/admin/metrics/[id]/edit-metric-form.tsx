"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateMetric, type MetricFormState } from "@/lib/admin/metric-actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
const labelClass = "flex flex-col gap-1.5 text-sm";
const labelText = "font-medium text-slate-700 dark:text-slate-200";

export type MetricInitial = {
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  dataType: string;
  unit: string | null;
  source: string | null;
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function EditMetricForm({
  metricId,
  initial,
  dataTypes,
}: {
  metricId: number;
  initial: MetricInitial;
  dataTypes: readonly string[];
}) {
  const [state, action] = useActionState<MetricFormState, FormData>(
    updateMetric.bind(null, metricId),
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={labelClass}>
        <span className={labelText}>Code</span>
        <input
          value={initial.code}
          readOnly
          className={`${inputClass} cursor-not-allowed font-mono text-xs opacity-70`}
        />
        <span className="text-xs text-slate-400">
          The stable key ingestion and search rely on — not editable.
        </span>
      </label>

      <label className={labelClass}>
        <span className={labelText}>Name</span>
        <input name="name" required defaultValue={initial.name} className={inputClass} />
      </label>

      <label className={labelClass}>
        <span className={labelText}>Description</span>
        <textarea
          name="description"
          rows={3}
          defaultValue={initial.description ?? ""}
          className={inputClass}
        />
        <span className="text-xs text-slate-400">
          Editing this re-embeds the metric on the next <code>embed:metrics</code> run.
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className={labelClass}>
          <span className={labelText}>Category</span>
          <input
            name="category"
            defaultValue={initial.category ?? ""}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span className={labelText}>Type</span>
          <select name="dataType" defaultValue={initial.dataType} className={inputClass}>
            {dataTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span className={labelText}>Unit</span>
          <input name="unit" defaultValue={initial.unit ?? ""} className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        <span className={labelText}>Source</span>
        <input name="source" defaultValue={initial.source ?? ""} className={inputClass} />
      </label>

      {state?.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <SaveButton />
        <Link
          href="/admin/metrics"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
