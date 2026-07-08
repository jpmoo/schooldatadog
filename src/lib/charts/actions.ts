"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { savedCharts } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { parseSpec } from "@/lib/viz/spec";

const nameSchema = z.string().trim().min(1, "Enter a name.").max(255);

export type SaveChartResult =
  | { ok: true; chart: { id: number; name: string } }
  | { ok: false; error: string };

/** Create a saved chart from a spec. Called from the Visualizer. */
export async function createChart(name: string, spec: unknown): Promise<SaveChartResult> {
  const user = await requireUser();
  const parsedName = nameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: parsedName.error.issues[0].message };
  const parsedSpec = parseSpec(spec);
  if (!parsedSpec) return { ok: false, error: "That chart spec isn't valid." };

  const [row] = await db
    .insert(savedCharts)
    .values({ userId: user.id, name: parsedName.data, spec: parsedSpec })
    .returning({ id: savedCharts.id, name: savedCharts.name });

  revalidatePath("/charts");
  return { ok: true, chart: row };
}

/** Update an existing chart's spec (and optionally name). Ownership-checked. */
export async function updateChart(
  id: number,
  spec: unknown,
  name?: string,
): Promise<SaveChartResult> {
  const user = await requireUser();
  const parsedSpec = parseSpec(spec);
  if (!parsedSpec) return { ok: false, error: "That chart spec isn't valid." };
  const values: Record<string, unknown> = { spec: parsedSpec, updatedAt: new Date() };
  if (name !== undefined) {
    const parsedName = nameSchema.safeParse(name);
    if (!parsedName.success) return { ok: false, error: parsedName.error.issues[0].message };
    values.name = parsedName.data;
  }
  const [row] = await db
    .update(savedCharts)
    .set(values)
    .where(and(eq(savedCharts.id, id), eq(savedCharts.userId, user.id)))
    .returning({ id: savedCharts.id, name: savedCharts.name });
  if (!row) return { ok: false, error: "Chart not found." };
  revalidatePath("/charts");
  return { ok: true, chart: row };
}

/** Rename a chart (form action; ownership-checked). */
export async function renameChart(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!Number.isInteger(id) || !parsed.success) return;
  await db
    .update(savedCharts)
    .set({ name: parsed.data, updatedAt: new Date() })
    .where(and(eq(savedCharts.id, id), eq(savedCharts.userId, user.id)));
  revalidatePath("/charts");
}

/** Delete a chart (form action; ownership-checked). */
export async function deleteChart(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await db.delete(savedCharts).where(and(eq(savedCharts.id, id), eq(savedCharts.userId, user.id)));
  revalidatePath("/charts");
}

/** Duplicate a chart (form action; ownership-checked). */
export async function duplicateChart(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  const [src] = await db
    .select({ name: savedCharts.name, spec: savedCharts.spec })
    .from(savedCharts)
    .where(and(eq(savedCharts.id, id), eq(savedCharts.userId, user.id)))
    .limit(1);
  if (!src) return;
  await db
    .insert(savedCharts)
    .values({ userId: user.id, name: `${src.name} (copy)`.slice(0, 255), spec: src.spec });
  revalidatePath("/charts");
}
