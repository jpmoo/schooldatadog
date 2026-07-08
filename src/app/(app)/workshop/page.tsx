import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { getUserGroups } from "@/lib/groups/queries";
import { getView } from "@/lib/views/queries";
import { searchMetrics } from "@/lib/workshop/actions";
import { getCounties, getEntities, getYears } from "@/lib/workshop/queries";
import { Workshop } from "./workshop";

export default async function WorkshopPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser();
  const { view } = await searchParams;
  const viewId = view ? Number(view) : NaN;

  const [years, counties, entities, initialMetrics, groups, saved, me] = await Promise.all([
    getYears(),
    getCounties(),
    getEntities(),
    searchMetrics(""),
    getUserGroups(),
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
      initialView={saved?.state ?? null}
      initialViewName={saved?.name ?? null}
      homeDistrictId={me?.homeDistrictId ?? null}
    />
  );
}
