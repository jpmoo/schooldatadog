"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

/** Change the signed-in user's own password after verifying the current one. */
export async function changeMyPassword(
  current: string,
  next: string,
): Promise<ChangePasswordResult> {
  const user = await requireUser();
  if (next.trim().length < 8) {
    return { ok: false, error: "New password must be at least 8 characters." };
  }
  const [row] = await db
    .select({ hash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row) return { ok: false, error: "Account not found." };
  if (!(await verifyPassword(current, row.hash))) {
    return { ok: false, error: "Current password is incorrect." };
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, user.id));
  return { ok: true };
}
