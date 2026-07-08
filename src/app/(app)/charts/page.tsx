import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { Icon } from "@/components/icon";
import { DeleteForm } from "@/app/(app)/_components/delete-form";
import { deleteChart, duplicateChart, renameChart } from "@/lib/charts/actions";
import { getUserCharts } from "@/lib/charts/queries";

export default async function ChartsPage() {
  await requireUser();
  const charts = await getUserCharts();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900 dark:text-white">
          <Icon name="savedItems" className="h-7 w-7 text-indigo-500" />
          Saved Visualizations
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Charts built in the{" "}
          <Link href="/visualizer" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Visualizer
          </Link>
          . Open to edit, or duplicate to branch a copy.
        </p>
      </div>

      {charts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          No charts yet. Build one in the <em>Visualizer</em> and click <em>Save chart</em>.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {charts.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <Link
                href={`/visualizer?chart=${c.id}`}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Open
              </Link>
              <form action={renameChart} className="flex min-w-0 flex-1 items-center gap-2">
                <input type="hidden" name="id" value={c.id} />
                <input
                  name="name"
                  defaultValue={c.name}
                  required
                  maxLength={255}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <button
                  type="submit"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Rename
                </button>
              </form>
              <span className="text-xs text-slate-400">
                {c.engine} · {c.updatedAt.toLocaleDateString()}
              </span>
              <form action={duplicateChart}>
                <input type="hidden" name="id" value={c.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Duplicate
                </button>
              </form>
              <DeleteForm
                action={deleteChart}
                id={c.id}
                confirmText={`Delete the chart “${c.name}”? This can't be undone.`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
