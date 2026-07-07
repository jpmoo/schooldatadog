import Link from "next/link";
import { and, asc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { metrics } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import { Pagination } from "../_components/pagination";

const PAGE_SIZE = 50;

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const category = (sp.category ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);

  const conds = [];
  if (q) conds.push(or(ilike(metrics.name, `%${q}%`), ilike(metrics.code, `%${q}%`)));
  if (category) conds.push(eq(metrics.category, category));
  const where = conds.length ? and(...conds) : undefined;

  const [rows, [{ total }], categories] = await Promise.all([
    db
      .select({
        id: metrics.id,
        code: metrics.code,
        name: metrics.name,
        category: metrics.category,
        dataType: metrics.dataType,
        unit: metrics.unit,
      })
      .from(metrics)
      .where(where)
      .orderBy(asc(metrics.category), asc(metrics.name))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(metrics).where(where),
    db
      .selectDistinct({ category: metrics.category })
      .from(metrics)
      .where(isNotNull(metrics.category))
      .orderBy(asc(metrics.category)),
  ]);

  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/metrics?${qs}` : "/admin/metrics";
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← System Settings
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
          Data Dictionary
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          {total.toLocaleString()} metric{total === 1 ? "" : "s"}
          {(q || category) && " matching"}.
        </p>
      </div>

      {/* Search + category filter (GET form) */}
      <form method="get" className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name or code…"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <select
          name="category"
          defaultValue={category}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category ?? ""}>
              {c.category}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          Search
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((m) => (
              <tr key={m.id} className="bg-white dark:bg-slate-950">
                <td className="px-4 py-2 text-slate-900 dark:text-slate-100">
                  {m.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                  {m.code}
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                  {m.category || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                  {m.dataType}
                  {m.unit ? ` (${m.unit})` : ""}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/metrics/${m.id}`}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No metrics match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} makeHref={makeHref} />
    </div>
  );
}
