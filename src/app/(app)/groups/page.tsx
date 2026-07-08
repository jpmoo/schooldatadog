import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import { Icon } from "@/components/icon";
import { DeleteForm } from "@/app/(app)/_components/delete-form";
import { deleteGroup, renameGroup } from "@/lib/groups/actions";
import { getUserGroupsWithEntities } from "@/lib/groups/queries";

export default async function GroupsPage() {
  await requireUser();
  const groups = await getUserGroupsWithEntities();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900 dark:text-white">
          <Icon name="saveViewOrGroup" className="h-7 w-7 text-indigo-500" />
          Saved Groups
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Collections of schools &amp; districts you can apply as a one-click filter in the{" "}
          <Link href="/workshop" className="text-indigo-600 hover:underline dark:text-indigo-400">
            Data Workshop
          </Link>
          .
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          You haven&apos;t created any groups yet. In the Data Workshop, tick the boxes next to
          schools or districts and choose <em>Create group</em>.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div
              key={g.id}
              className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <form action={renameGroup} className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="id" value={g.id} />
                  <input
                    name="name"
                    defaultValue={g.name}
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
                <DeleteForm
                  action={deleteGroup}
                  id={g.id}
                  confirmText={`Delete the group “${g.name}”? This can't be undone.`}
                />
              </div>

              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-slate-500 dark:text-slate-400">
                  {g.entities.length} {g.entities.length === 1 ? "entity" : "entities"} — preview
                </summary>
                <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {g.entities.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                      <span
                        className={`inline-block rounded px-1 text-[10px] uppercase ${
                          e.type === "district"
                            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {e.type}
                      </span>
                      <span className="truncate">{e.name}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
