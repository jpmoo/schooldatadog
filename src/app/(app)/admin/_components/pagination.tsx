import Link from "next/link";

/**
 * Prev/next pager for admin list pages. `makeHref` builds the URL for a page
 * number (preserving the current filters). Renders nothing for a single page.
 */
export function Pagination({
  page,
  pageSize,
  total,
  makeHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  makeHref: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const linkClass =
    "rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";
  const disabledClass =
    "rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-300 dark:border-slate-800 dark:text-slate-700";

  return (
    <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
      <span>
        {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={makeHref(page - 1)} className={linkClass}>
            ‹ Prev
          </Link>
        ) : (
          <span className={disabledClass}>‹ Prev</span>
        )}
        <span className="tabular-nums">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={makeHref(page + 1)} className={linkClass}>
            Next ›
          </Link>
        ) : (
          <span className={disabledClass}>Next ›</span>
        )}
      </div>
    </div>
  );
}
