"use client";

import { Icon } from "@/components/icon";
import type { DistrictOption } from "@/lib/admin/districts";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

const labelClass = "flex flex-col gap-1.5 text-sm";
const labelText = "font-medium text-slate-700 dark:text-slate-200";
const labelTextRow = `${labelText} flex items-center gap-1.5`;

export type UserInitial = {
  name?: string | null;
  email?: string;
  role?: "admin" | "user";
  homeDistrictId?: number | null;
};

/**
 * The shared name/email/password/role/home-district inputs, used by both the
 * create and edit forms. `passwordRequired` distinguishes create (required)
 * from edit (blank = keep current password).
 */
export function UserFields({
  districts,
  initial,
  passwordRequired,
}: {
  districts: DistrictOption[];
  initial?: UserInitial;
  passwordRequired: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={labelClass}>
        <span className={labelText}>
          Name <span className="text-slate-400">(optional)</span>
        </span>
        <input
          name="name"
          type="text"
          autoComplete="off"
          defaultValue={initial?.name ?? ""}
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        <span className={labelTextRow}>
          <Icon name="email" className="h-4 w-4 text-slate-400" />
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="off"
          defaultValue={initial?.email ?? ""}
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        <span className={labelText}>
          Password{" "}
          {!passwordRequired && (
            <span className="text-slate-400">(leave blank to keep current)</span>
          )}
        </span>
        <input
          name="password"
          type="password"
          required={passwordRequired}
          minLength={8}
          autoComplete="new-password"
          placeholder={passwordRequired ? "" : "••••••••"}
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        <span className={labelTextRow}>
          <Icon name="role" className="h-4 w-4 text-slate-400" />
          Role
        </span>
        <select
          name="role"
          defaultValue={initial?.role ?? "user"}
          className={inputClass}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </label>

      <label className={`${labelClass} sm:col-span-2`}>
        <span className={labelText}>
          Home district <span className="text-slate-400">(optional)</span>
        </span>
        <select
          name="homeDistrictId"
          defaultValue={initial?.homeDistrictId?.toString() ?? ""}
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
    </div>
  );
}
