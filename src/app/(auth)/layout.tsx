import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex flex-col items-center gap-3 text-slate-900 dark:text-white"
        >
          <span
            role="img"
            aria-label="School Data Dog logo"
            className="brand-logo h-28"
          />
          <span className="text-2xl font-bold tracking-tight">
            School Data Dog
          </span>
        </Link>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {children}
        </div>
      </div>
    </main>
  );
}
