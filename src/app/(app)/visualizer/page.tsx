import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { getChart } from "@/lib/charts/queries";
import { getUserGroups } from "@/lib/groups/queries";
import { getUserViews } from "@/lib/views/queries";
import { searchMetrics } from "@/lib/workshop/actions";
import { getDemographicMetricCodes, getEntities, getYears } from "@/lib/workshop/queries";
import { Visualizer } from "./visualizer";

export default async function VisualizerPage({
  searchParams,
}: {
  searchParams: Promise<{ chart?: string; view?: string }>;
}) {
  const user = await requireUser();
  const { chart, view } = await searchParams;
  const chartId = chart ? Number(chart) : NaN;
  const importViewId = view && Number.isInteger(Number(view)) ? Number(view) : null;

  const years = await getYears();
  const [entities, initialMetrics, groups, views, demographicMetrics, saved, me] = await Promise.all([
    getEntities(),
    searchMetrics("", years[0]),
    getUserGroups(),
    getUserViews(),
    getDemographicMetricCodes(),
    Number.isInteger(chartId) ? getChart(chartId) : Promise.resolve(null),
    db.select({ homeDistrictId: users.homeDistrictId }).from(users).where(eq(users.id, user.id)),
  ]);

  return (
    <Visualizer
      years={years}
      entities={entities}
      initialMetrics={initialMetrics}
      groups={groups}
      views={views}
      demographicMetrics={demographicMetrics}
      initialChart={saved}
      homeDistrictId={me[0]?.homeDistrictId ?? null}
      importViewId={importViewId}
      isAdmin={user.role === "admin"}
    />
  );
}
