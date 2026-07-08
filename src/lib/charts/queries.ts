import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedCharts } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import type { ChartSpec } from "@/lib/viz/spec";

export type SavedChartMeta = { id: number; name: string; updatedAt: Date; engine: string };

/** The current user's saved charts (metadata only), most-recently-updated first. */
export async function getUserCharts(): Promise<SavedChartMeta[]> {
  const user = await requireUser();
  const rows = await db
    .select({
      id: savedCharts.id,
      name: savedCharts.name,
      updatedAt: savedCharts.updatedAt,
      spec: savedCharts.spec,
    })
    .from(savedCharts)
    .where(eq(savedCharts.userId, user.id))
    .orderBy(desc(savedCharts.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updatedAt,
    engine: String((r.spec as Partial<ChartSpec>)?.engine ?? "vega-lite"),
  }));
}

/** One saved chart's full spec (ownership-checked), or null. */
export async function getChart(
  id: number,
): Promise<{ id: number; name: string; spec: ChartSpec } | null> {
  const user = await requireUser();
  const [row] = await db
    .select({ id: savedCharts.id, name: savedCharts.name, spec: savedCharts.spec })
    .from(savedCharts)
    .where(and(eq(savedCharts.id, id), eq(savedCharts.userId, user.id)))
    .limit(1);
  return row ? { id: row.id, name: row.name, spec: row.spec as ChartSpec } : null;
}
