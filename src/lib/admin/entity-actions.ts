"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { entities, entityType } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guards";

export type EntityFormState = { error?: string } | undefined;

const schema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(512),
  type: z.enum(entityType.enumValues),
  county: z
    .string()
    .trim()
    .max(128)
    .transform((v) => (v === "" ? null : v))
    .optional(),
});

/** Parent-district select value ("" or id string) -> id or null. */
function parseParentId(raw: FormDataEntryValue | null): number | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function updateEntity(
  entityId: number,
  _prev: EntityFormState,
  formData: FormData,
): Promise<EntityFormState> {
  await requireAdmin();

  const parsed = schema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    county: formData.get("county") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  let parentDistrictId = parseParentId(formData.get("parentDistrictId"));
  if (parentDistrictId === entityId) parentDistrictId = null; // no self-parent

  const { name, type, county } = parsed.data;
  await db
    .update(entities)
    .set({ name, type, county: county ?? null, parentDistrictId })
    .where(eq(entities.id, entityId));

  revalidatePath("/admin/entities");
  redirect("/admin/entities");
}
