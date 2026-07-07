import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dataType, metrics } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import { EditMetricForm } from "./edit-metric-form";

export default async function EditMetricPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const metricId = Number(id);
  if (!Number.isInteger(metricId) || metricId <= 0) notFound();

  const [metric] = await db
    .select({
      id: metrics.id,
      code: metrics.code,
      name: metrics.name,
      category: metrics.category,
      description: metrics.description,
      dataType: metrics.dataType,
      unit: metrics.unit,
      source: metrics.source,
    })
    .from(metrics)
    .where(eq(metrics.id, metricId))
    .limit(1);

  if (!metric) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link
          href="/admin/metrics"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Data Dictionary
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
          {metric.name}
        </h1>
      </div>

      <EditMetricForm
        metricId={metric.id}
        initial={{
          code: metric.code,
          name: metric.name,
          category: metric.category,
          description: metric.description,
          dataType: metric.dataType,
          unit: metric.unit,
          source: metric.source,
        }}
        dataTypes={dataType.enumValues}
      />
    </div>
  );
}
