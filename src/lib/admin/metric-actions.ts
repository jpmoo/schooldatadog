"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dataType, metrics } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guards";

export type MetricFormState = { error?: string } | undefined;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .optional();

const schema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(255),
  category: optionalText(128),
  description: optionalText(5000),
  dataType: z.enum(dataType.enumValues),
  unit: optionalText(64),
  source: optionalText(255),
});

/**
 * Update a metric definition. `code` is intentionally not editable — it's the
 * natural key that ingestion upserts on and embeddings hash. Editing the text
 * changes the embedding input hash, so the next `embed:metrics` run re-embeds it.
 */
export async function updateMetric(
  metricId: number,
  _prev: MetricFormState,
  formData: FormData,
): Promise<MetricFormState> {
  await requireAdmin();

  const parsed = schema.safeParse({
    name: formData.get("name"),
    category: formData.get("category") ?? "",
    description: formData.get("description") ?? "",
    dataType: formData.get("dataType"),
    unit: formData.get("unit") ?? "",
    source: formData.get("source") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { name, category, description, dataType: dt, unit, source } = parsed.data;
  await db
    .update(metrics)
    .set({
      name,
      category: category ?? null,
      description: description ?? null,
      dataType: dt,
      unit: unit ?? null,
      source: source ?? null,
    })
    .where(eq(metrics.id, metricId));

  revalidatePath("/admin/metrics");
  redirect("/admin/metrics");
}
