import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, facts, metrics } from "@/db/schema";
import { Icon, type IconName } from "@/components/icon";
import { getCurrentSession } from "@/lib/auth/session";

type Tile = { title: string; body: string; href: string; icon?: IconName; adminOnly?: boolean };

const tiles: Tile[] = [
  {
    title: "Data Workshop",
    body: "Build comparative spreadsheets — drag in metrics, add calculated fields, and filter.",
    href: "/workshop",
    icon: "dataWorkshop",
  },
  {
    title: "Saved Views",
    body: "Reopen, rename, or delete full workshop sessions — filters, sorts, and calculated fields.",
    href: "/views",
    icon: "savedItems",
  },
  {
    title: "Saved Groups",
    body: "Preview, rename, and delete the school & district groups you use as workshop filters.",
    href: "/groups",
    icon: "saveViewOrGroup",
  },
  {
    title: "System Settings",
    body: "Admin tools for AI/Ollama, the data dictionary, entities, and user accounts.",
    href: "/admin",
    adminOnly: true,
  },
];

async function countRows(table: typeof metrics | typeof entities | typeof facts) {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table);
  return count;
}

export default async function DashboardPage() {
  const { user } = await getCurrentSession();
  const isAdmin = user?.role === "admin";

  const [metricCount, entityCount, factCount] = await Promise.all([
    countRows(metrics),
    countRows(entities),
    countRows(facts),
  ]);

  const stats = [
    { label: "Metrics in Data Dictionary", value: metricCount },
    { label: "Schools & districts", value: entityCount },
    { label: "Data points", value: factCount },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Welcome{user?.name ? `, ${user.name}` : ""} 👋
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Explore and compare New York State school &amp; district data.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
              {s.value.toLocaleString()}
            </div>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tiles
          .filter((t) => !t.adminOnly || isAdmin)
          .map((t) => (
          <Link
            key={t.title}
            href={t.href}
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
          >
            <h2 className="flex items-center gap-2.5 font-semibold text-slate-900 dark:text-white">
              {t.icon && <Icon name={t.icon} className="h-7 w-7 text-indigo-500" />}
              {t.title}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t.body}</p>
          </Link>
        ))}
      </div>

      {factCount === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="text-slate-600 dark:text-slate-300">
            No data yet.{" "}
            {isAdmin ? (
              <>
                Load the data payloads on the server with{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">
                  npm run db:load
                </code>{" "}
                (see the deployment guide).
              </>
            ) : (
              <>An administrator needs to load data before you can explore it.</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
