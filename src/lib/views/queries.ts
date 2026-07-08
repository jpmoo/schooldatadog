import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
import { logActivity } from "@/lib/activity/log";
import { requireUser } from "@/lib/auth/guards";
import type { SavedViewState } from "@/app/(app)/workshop/columns";

export type SavedViewMeta = { id: number; name: string; updatedAt: Date; columnCount: number };

/** The current user's saved views (metadata only), most-recently-updated first. */
export async function getUserViews(): Promise<SavedViewMeta[]> {
  const user = await requireUser();
  const rows = await db
    .select({
      id: savedViews.id,
      name: savedViews.name,
      updatedAt: savedViews.updatedAt,
      state: savedViews.state,
    })
    .from(savedViews)
    .where(eq(savedViews.userId, user.id))
    .orderBy(desc(savedViews.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updatedAt,
    columnCount: Array.isArray((r.state as SavedViewState)?.columns)
      ? (r.state as SavedViewState).columns.length
      : 0,
  }));
}

/** One saved view's full state (ownership-checked), or null. */
export async function getView(
  id: number,
): Promise<{ id: number; name: string; state: SavedViewState } | null> {
  const user = await requireUser();
  const [row] = await db
    .select({ id: savedViews.id, name: savedViews.name, state: savedViews.state })
    .from(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, user.id)))
    .limit(1);
  if (row) await logActivity(user.id, "view.load", "view", row.name);
  return row ? { id: row.id, name: row.name, state: row.state as SavedViewState } : null;
}
