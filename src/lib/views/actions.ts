"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import type { SavedViewState } from "@/app/(app)/workshop/columns";

const nameSchema = z.string().trim().min(1, "Enter a name.").max(255);

export type CreateViewResult =
  | { ok: true; view: { id: number; name: string } }
  | { ok: false; error: string };

/** Save the current workshop state as a named view. Called from the workshop. */
export async function createView(
  name: string,
  state: SavedViewState,
): Promise<CreateViewResult> {
  const user = await requireUser();

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!state || !Array.isArray(state.columns)) {
    return { ok: false, error: "Nothing to save yet." };
  }

  const [row] = await db
    .insert(savedViews)
    .values({ userId: user.id, name: parsed.data, state })
    .returning({ id: savedViews.id, name: savedViews.name });

  revalidatePath("/views");
  return { ok: true, view: row };
}

/** Rename a view (form action; ownership-checked). */
export async function renameView(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const parsed = nameSchema.safeParse(formData.get("name"));
  if (!Number.isInteger(id) || !parsed.success) return;

  await db
    .update(savedViews)
    .set({ name: parsed.data, updatedAt: new Date() })
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, user.id)));

  revalidatePath("/views");
}

/** Delete a view (form action; ownership-checked). */
export async function deleteView(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;

  await db
    .delete(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, user.id)));

  revalidatePath("/views");
}
