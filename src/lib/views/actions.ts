"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { savedViews } from "@/db/schema";
import { logActivity } from "@/lib/activity/log";
import { requireUser } from "@/lib/auth/guards";
import type { SavedViewState } from "@/app/(app)/workshop/columns";

const nameSchema = z.string().trim().min(1, "Enter a name.").max(255);

export type CreateViewResult =
  | { ok: true; view: { id: number; name: string } }
  | { ok: false; error: string }
  | { ok: false; conflict: { id: number; name: string } };

/**
 * Save the current workshop state as a named view. If a view with the same name
 * already exists (and `force` is false), returns a `conflict` so the caller can
 * offer overwrite-vs-save-new.
 */
export async function createView(
  name: string,
  state: SavedViewState,
  force = false,
): Promise<CreateViewResult> {
  const user = await requireUser();

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!state || !Array.isArray(state.columns)) {
    return { ok: false, error: "Nothing to save yet." };
  }

  if (!force) {
    const [existing] = await db
      .select({ id: savedViews.id, name: savedViews.name })
      .from(savedViews)
      .where(
        and(eq(savedViews.userId, user.id), sql`lower(${savedViews.name}) = lower(${parsed.data})`),
      )
      .orderBy(desc(savedViews.updatedAt))
      .limit(1);
    if (existing) return { ok: false, conflict: existing };
  }

  const [row] = await db
    .insert(savedViews)
    .values({ userId: user.id, name: parsed.data, state })
    .returning({ id: savedViews.id, name: savedViews.name });

  await logActivity(user.id, "view.save", "view", row.name);
  revalidatePath("/views");
  return { ok: true, view: row };
}

/** Overwrite an existing view's state (ownership-checked). */
export async function overwriteView(
  id: number,
  state: SavedViewState,
): Promise<CreateViewResult> {
  const user = await requireUser();
  if (!state || !Array.isArray(state.columns)) return { ok: false, error: "Nothing to save yet." };
  const [row] = await db
    .update(savedViews)
    .set({ state, updatedAt: new Date() })
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, user.id)))
    .returning({ id: savedViews.id, name: savedViews.name });
  if (!row) return { ok: false, error: "View not found." };
  await logActivity(user.id, "view.save", "view", row.name);
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
