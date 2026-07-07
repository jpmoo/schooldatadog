import { requireUser } from "@/lib/auth/guards";
import { searchMetrics } from "@/lib/workshop/actions";
import { getCounties, getEntities, getYears } from "@/lib/workshop/queries";
import { Workshop } from "./workshop";

export default async function WorkshopPage() {
  await requireUser();

  const [years, counties, entities, initialMetrics] = await Promise.all([
    getYears(),
    getCounties(),
    getEntities(),
    searchMetrics(""),
  ]);

  return (
    <Workshop
      years={years}
      counties={counties}
      entities={entities}
      initialMetrics={initialMetrics}
    />
  );
}
