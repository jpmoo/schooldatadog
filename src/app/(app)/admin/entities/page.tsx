import Link from "next/link";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { entities, entityType } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import { Pagination } from "../_components/pagination";

const PAGE_SIZE = 50;

export default async function EntitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; page?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const type = (sp.type ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);

  const parent = alias(entities, "parent");

  const conds = [];
  if (q) conds.push(or(ilike(entities.name, `%${q}%`), ilike(entities.bedsCode, `%${q}%`)));
  if (type && (entityType.enumValues as readonly string[]).includes(type)) {
    conds.push(eq(entities.type, type as (typeof entityType.enumValues)[number]));
  }
  const where = conds.length ? and(...conds) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: entities.id,
        bedsCode: entities.bedsCode,
        name: entities.name,
        type: entities.type,
        county: entities.county,
        parentName: parent.name,
      })
      .from(entities)
      .leftJoin(parent, eq(entities.parentDistrictId, parent.id))
      .where(where)
      .orderBy(asc(entities.name))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(entities).where(where),
  ]);

  const makeHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/entities?${qs}` : "/admin/entities";
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
          Entities
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          {total.toLocaleString()} school{total === 1 ? "" : "s"} &amp; district
          {(q || type) && " matching"}.
        </p>
      </div>

      <form method="get" className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search name or BEDS code…"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <select
          name="type"
          defaultValue={type}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        >
          <option value="">All types</option>
          {entityType.enumValues.map((t) => (
            <option key={t} value={t}>
              {t}
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
              <th className="px-4 py-2 font-medium">BEDS</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">County</th>
              <th className="px-4 py-2 font-medium">District</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((e) => (
              <tr key={e.id} className="bg-white dark:bg-slate-950">
                <td className="px-4 py-2 text-slate-900 dark:text-slate-100">
                  {e.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                  {e.bedsCode || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                  {e.type}
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                  {e.county || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                  {e.parentName || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/entities/${e.id}`}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No entities match.
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
