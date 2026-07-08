import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { getUserGroups } from "@/lib/groups/queries";
import { searchMetrics } from "@/lib/workshop/actions";
import { getCounties, getEntities, getYears } from "@/lib/workshop/queries";
import { Workshop } from "./workshop";

export default async function WorkshopPage() {
  const user = await requireUser();

  const [years, counties, entities, initialMetrics, groups, me] = await Promise.all([
    getYears(),
    getCounties(),
    getEntities(),
    searchMetrics(""),
    getUserGroups(),
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
      homeDistrictId={me?.homeDistrictId ?? null}
    />
  );
}
