import { requireUser } from "@/lib/auth/guards";
import { getChart } from "@/lib/charts/queries";
import { getUserGroups } from "@/lib/groups/queries";
import { searchMetrics } from "@/lib/workshop/actions";
import { getDemographicMetricCodes, getEntities, getYears } from "@/lib/workshop/queries";
import { Visualizer } from "./visualizer";

export default async function VisualizerPage({
  searchParams,
}: {
  searchParams: Promise<{ chart?: string }>;
}) {
  await requireUser();
  const { chart } = await searchParams;
  const chartId = chart ? Number(chart) : NaN;

  const years = await getYears();
  const [entities, initialMetrics, groups, demographicMetrics, saved] = await Promise.all([
    getEntities(),
    searchMetrics("", years[0]),
    getUserGroups(),
    getDemographicMetricCodes(),
    Number.isInteger(chartId) ? getChart(chartId) : Promise.resolve(null),
  ]);

  return (
    <Visualizer
      years={years}
      entities={entities}
      initialMetrics={initialMetrics}
      groups={groups}
      demographicMetrics={demographicMetrics}
      initialChart={saved}
    />
  );
}
