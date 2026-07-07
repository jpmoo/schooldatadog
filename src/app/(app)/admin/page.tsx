import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";

type Tool = {
  title: string;
  body: string;
  status: string;
  href?: string;
};

export default async function AdminPage() {
  // Gate: only admins reach this page (plain users are redirected to /).
  await requireAdmin();

  const tools: Tool[] = [
    {
      title: "AI / Ollama",
      body: "Connect to your Ollama server by IP/port and choose the inference and embedding models.",
      status: "Available",
      href: "/admin/ai",
    },
    {
      title: "Data Dictionary",
      body: "Browse and edit metric definitions — descriptions, categories, units, and types.",
      status: "Next up",
    },
    {
      title: "Entities",
      body: "Manage schools & districts (BEDS codes, county, district rollups).",
      status: "Next up",
    },
    {
      title: "Users",
      body: "Review accounts and grant or revoke admin access.",
      status: "Next up",
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          System Settings
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Admin tools for AI, the data dictionary, entities, and users.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tools.map((t) => {
          const available = Boolean(t.href);
          const inner = (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  {t.title}
                </h2>
                <span
                  className={
                    available
                      ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  }
                >
                  {t.status}
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t.body}
              </p>
            </>
          );

          return t.href ? (
            <Link
              key={t.title}
              href={t.href}
              className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
            >
              {inner}
            </Link>
          ) : (
            <div
              key={t.title}
              className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 opacity-70 dark:border-slate-800 dark:bg-slate-900"
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
