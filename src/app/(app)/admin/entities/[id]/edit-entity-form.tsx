"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { DistrictOption } from "@/lib/admin/districts";
import { updateEntity, type EntityFormState } from "@/lib/admin/entity-actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
const labelClass = "flex flex-col gap-1.5 text-sm";
const labelText = "font-medium text-slate-700 dark:text-slate-200";

export type EntityInitial = {
  bedsCode: string | null;
  name: string;
  type: string;
  county: string | null;
  parentDistrictId: number | null;
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

export function EditEntityForm({
  entityId,
  initial,
  districts,
  entityTypes,
}: {
  entityId: number;
  initial: EntityInitial;
  districts: DistrictOption[];
  entityTypes: readonly string[];
}) {
  const [state, action] = useActionState<EntityFormState, FormData>(
    updateEntity.bind(null, entityId),
    undefined,
  );

  // Offer school/district; keep the current value if it's something else
  // (e.g. a legacy statewide-aggregate row) so saving doesn't silently retype it.
  const typeOptions = entityTypes.includes(initial.type)
    ? entityTypes
    : [initial.type, ...entityTypes];

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={labelClass}>
        <span className={labelText}>BEDS code</span>
        <input
          value={initial.bedsCode ?? ""}
          readOnly
          className={`${inputClass} cursor-not-allowed font-mono text-xs opacity-70`}
        />
        <span className="text-xs text-slate-400">
          The natural key that data loads upsert on — not editable.
        </span>
      </label>

      <label className={labelClass}>
        <span className={labelText}>Name</span>
        <input name="name" required defaultValue={initial.name} className={inputClass} />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          <span className={labelText}>Type</span>
          <select name="type" defaultValue={initial.type} className={inputClass}>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span className={labelText}>County</span>
          <input
            name="county"
            defaultValue={initial.county ?? ""}
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        <span className={labelText}>
          Parent district <span className="text-slate-400">(for schools)</span>
        </span>
        <select
          name="parentDistrictId"
          defaultValue={initial.parentDistrictId?.toString() ?? ""}
          className={inputClass}
        >
          <option value="">— None —</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
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
          href="/admin/entities"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
