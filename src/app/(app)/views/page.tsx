import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { deleteView, renameView } from "@/lib/views/actions";
import { getUserViews } from "@/lib/views/queries";

export default async function ViewsPage() {
  await requireUser();
  const views = await getUserViews();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Saved Views</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Full{" "}
          <Link href="/workshop" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Data Workshop
          </Link>{" "}
          sessions — every filter, sort, and column (including calculated fields), saved to reopen
          in one click.
        </p>
      </div>

      {views.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          You haven&apos;t saved any views yet. Build a sheet in the Data Workshop, then click{" "}
          <em>Save view</em>.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {views.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <Link
                href={`/workshop?view=${v.id}`}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Open
              </Link>
              <form action={renameView} className="flex min-w-0 flex-1 items-center gap-2">
                <input type="hidden" name="id" value={v.id} />
                <input
                  name="name"
                  defaultValue={v.name}
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
                {v.columnCount} column{v.columnCount === 1 ? "" : "s"} ·{" "}
                {v.updatedAt.toLocaleDateString()}
              </span>
              <form action={deleteView}>
                <input type="hidden" name="id" value={v.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Delete
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
