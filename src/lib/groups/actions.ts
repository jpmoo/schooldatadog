"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { entities, entityGroups } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import type { GroupLite } from "./queries";

const nameSchema = z.string().trim().min(1, "Enter a name.").max(255);

/** Keep only ids that are real entities, deduped and capped. */
async function sanitizeEntityIds(raw: number[]): Promise<number[]> {
  const ids = [...new Set(raw.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20000);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .where(inArray(entities.id, ids));
  const existing = new Set(rows.map((r) => r.id));
  return ids.filter((id) => existing.has(id));
}

export type CreateGroupResult =
  | { ok: true; group: GroupLite }
  | { ok: false; error: string };

/** Create a saved group from a set of entity ids. Called from the workshop. */
export async function createGroup(
  name: string,
  entityIds: number[],
): Promise<CreateGroupResult> {
  const user = await requireUser();

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const ids = await sanitizeEntityIds(entityIds);
  if (ids.length === 0) return { ok: false, error: "Select at least one entity." };

  const [row] = await db
    .insert(entityGroups)
    .values({ userId: user.id, name: parsed.data, entityIds: ids })
    .returning({ id: entityGroups.id, name: entityGroups.name, entityIds: entityGroups.entityIds });

  revalidatePath("/groups");
  return { ok: true, group: { id: row.id, name: row.name, entityIds: row.entityIds ?? [] } };
}

/** Rename a group (form action; ownership-checked). */
export async function renameGroup(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!Number.isInteger(id) || !parsed.success) return;

  await db
    .update(entityGroups)
    .set({ name: parsed.data, updatedAt: new Date() })
    .where(and(eq(entityGroups.id, id), eq(entityGroups.userId, user.id)));

  revalidatePath("/groups");
}

/** Delete a group (form action; ownership-checked). */
export async function deleteGroup(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;

  await db
    .delete(entityGroups)
    .where(and(eq(entityGroups.id, id), eq(entityGroups.userId, user.id)));

  revalidatePath("/groups");
}
