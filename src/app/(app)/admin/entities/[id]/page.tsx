import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entities, entityType } from "@/db/schema";
import { getDistricts } from "@/lib/admin/districts";
import { requireAdmin } from "@/lib/auth/guards";
import { EditEntityForm } from "./edit-entity-form";

export default async function EditEntityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const entityId = Number(id);
  if (!Number.isInteger(entityId) || entityId <= 0) notFound();

  const [entity, districts] = await Promise.all([
    db
      .select({
        id: entities.id,
        bedsCode: entities.bedsCode,
        name: entities.name,
        type: entities.type,
        county: entities.county,
        parentDistrictId: entities.parentDistrictId,
      })
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1)
      .then((r) => r[0]),
    getDistricts(),
  ]);

  if (!entity) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/admin/entities"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Entities
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
          {entity.name}
        </h1>
      </div>

      <EditEntityForm
        entityId={entity.id}
        initial={{
          bedsCode: entity.bedsCode,
          name: entity.name,
          type: entity.type,
          county: entity.county,
          parentDistrictId: entity.parentDistrictId,
        }}
        districts={districts}
        entityTypes={entityType.enumValues.filter((t) => t !== "state")}
      />
    </div>
  );
}
