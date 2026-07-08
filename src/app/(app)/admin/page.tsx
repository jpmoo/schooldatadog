import Link from "next/link";
import { Icon } from "@/components/icon";
import { requireAdmin } from "@/lib/auth/guards";

type Tool = { title: string; body: string; href: string };

const tools: Tool[] = [
  {
    title: "AI / Ollama",
    body: "Connect to your Ollama server by IP/port and choose the inference and embedding models.",
    href: "/admin/ai",
  },
  {
    title: "Data Dictionary",
    body: "Browse and edit metric definitions — descriptions, categories, units, and types.",
    href: "/admin/metrics",
  },
  {
    title: "Entities",
    body: "Browse and edit schools & districts (BEDS codes, county, district rollups).",
    href: "/admin/entities",
  },
  {
    title: "Users",
    body: "Create, edit, and remove accounts; set roles and home districts.",
    href: "/admin/users",
  },
];

export default async function AdminPage() {
  // Gate: only admins reach this page (plain users are redirected to /).
  await requireAdmin();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-slate-900 dark:text-white">
          <Icon name="Settings" className="h-7 w-7 text-indigo-500" />
          System Settings
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Admin tools for AI, the data dictionary, entities, and users.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {tools.map((t) => (
          <Link
            key={t.title}
            href={t.href}
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-700"
          >
            <h2 className="font-semibold text-slate-900 dark:text-white">
              {t.title}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t.body}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
