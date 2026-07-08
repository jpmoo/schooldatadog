import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { getUserGroups } from "@/lib/groups/queries";
import { getView } from "@/lib/views/queries";
import { searchMetrics } from "@/lib/workshop/actions";
import {
  getCounties,
  getDemographicMetricCodes,
  getEntities,
  getYears,
} from "@/lib/workshop/queries";
import { Workshop } from "./workshop";

export default async function WorkshopPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser();
  const { view } = await searchParams;
  const viewId = view ? Number(view) : NaN;

  const years = await getYears();
  const [counties, entities, initialMetrics, groups, demographicMetrics, saved, me] =
    await Promise.all([
      getCounties(),
      getEntities(),
      searchMetrics("", years[0]),
      getUserGroups(),
      getDemographicMetricCodes(),
      Number.isInteger(viewId) ? getView(viewId) : Promise.resolve(null),
      db
        .select({ homeDistrictId: users.homeDistrictId })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1)
        .then((r) => r[0]),
    ]);

  return (
    <Workshop
      years={years}
      counties={counties}
      entities={entities}
      initialMetrics={initialMetrics}
      initialGroups={groups}
      demographicMetrics={demographicMetrics}
      initialView={saved?.state ?? null}
      initialViewName={saved?.name ?? null}
      homeDistrictId={me?.homeDistrictId ?? null}
    />
  );
}
