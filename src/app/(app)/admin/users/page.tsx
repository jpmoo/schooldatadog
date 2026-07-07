import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { entities, users } from "@/db/schema";
import { getDistricts } from "@/lib/admin/districts";
import { requireAdmin } from "@/lib/auth/guards";
import { CreateUserForm } from "./create-user-form";

export default async function UsersPage() {
  const admin = await requireAdmin();

  const [rows, districts] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        districtName: entities.name,
      })
      .from(users)
      .leftJoin(entities, eq(users.homeDistrictId, entities.id))
      .orderBy(asc(users.email)),
    getDistricts(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/admin"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← System Settings
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
          Users
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          {rows.length} account{rows.length === 1 ? "" : "s"}.
        </p>
      </div>

      {/* Explorer */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Home district</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((u) => (
              <tr key={u.id} className="bg-white dark:bg-slate-950">
                <td className="px-4 py-2 text-slate-900 dark:text-slate-100">
                  {u.name || <span className="text-slate-400">—</span>}
                  {u.id === admin.id && (
                    <span className="ml-2 text-xs text-slate-400">(you)</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                  {u.email}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={
                      u.role === "admin"
                        ? "rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                        : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                  {u.districtName || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Creator */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 font-semibold text-slate-900 dark:text-white">
          Create a user
        </h2>
        <CreateUserForm districts={districts} />
      </section>
    </div>
  );
}
