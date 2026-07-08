import Link from "next/link";
import { Icon } from "@/components/icon";
import { requireAdmin } from "@/lib/auth/guards";
import { ACTION_LABELS, getActivityLog, getLogFilterOptions } from "@/lib/activity/log";

const asInt = (v: string | undefined) => {
  const n = Number(v);
  return v && Number.isInteger(n) ? n : undefined;
};

export default async function AdminLogPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; district?: string; action?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const filters = {
    userId: asInt(sp.user),
    districtId: asInt(sp.district),
    action: sp.action || undefined,
  };
  const [rows, options] = await Promise.all([getActivityLog(filters), getLogFilterOptions()]);
  const hasFilter = !!(filters.userId || filters.districtId || filters.action);

  const selectCls =
    "h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Administration
        </Link>
        <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-bold text-slate-900 dark:text-white">
          <Icon name="Settings" className="h-7 w-7 text-indigo-500" />
          Activity Log
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Sign-ins, sign-outs, and saves/loads of views, groups, and visualizations.
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          User
          <select name="user" defaultValue={sp.user ?? ""} className={selectCls}>
            <option value="">All users</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          Home district
          <select name="district" defaultValue={sp.district ?? ""} className={selectCls}>
            <option value="">All districts</option>
            {options.districts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          Action
          <select name="action" defaultValue={sp.action ?? ""} className={selectCls}>
            <option value="">All actions</option>
            {options.actions.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          <Icon name="apply" className="h-4 w-4" />
          Apply
        </button>
        {hasFilter && (
          <Link
            href="/admin/log"
            className="flex h-9 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Home district</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Item</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">No activity matches these filters.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500 dark:text-slate-400">
                    {r.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-slate-800 dark:text-slate-100">
                    {r.userName || r.userEmail || <span className="text-slate-400">(deleted user)</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {r.homeDistrict || <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                    {ACTION_LABELS[r.action] ?? r.action}
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {r.targetName || <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
