import Link from "next/link";
import { Icon } from "@/components/icon";
import { requireUser } from "@/lib/auth/guards";
import { logout } from "@/lib/auth/actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <nav className="flex items-center">
            <Link
              href="/"
              className="flex items-center gap-2 text-slate-900 dark:text-white"
            >
              <span
                role="img"
                aria-label="Data Dog logo"
                className="brand-logo h-8"
              />
              <span className="font-bold tracking-tight">Data Dog</span>
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-slate-500 sm:inline dark:text-slate-400">
              {user.name || user.email}
            </span>
            {isAdmin && (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                admin
              </span>
            )}
            <form action={logout}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Icon name="logout" className="h-4 w-4" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
