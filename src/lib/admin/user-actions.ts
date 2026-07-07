"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { entities, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";

export type UserFormState = { error?: string; ok?: boolean } | undefined;

const emailField = z.string().trim().toLowerCase().email("Enter a valid email address.");
const nameField = z.string().trim().max(255).optional();
const roleField = z.enum(["admin", "user"]);

/** Home-district select value ("" or an id string) -> id or null. */
function parseDistrictId(raw: FormDataEntryValue | null): number | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && err.code === "23505",
  );
}

/** Ensure a district id, if given, actually refers to a district entity. */
async function validDistrictId(id: number | null): Promise<number | null> {
  if (id === null) return null;
  const [row] = await db
    .select({ id: entities.id })
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1);
  return row ? id : null;
}

const createSchema = z.object({
  name: nameField,
  email: emailField,
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  role: roleField.default("user"),
});

export async function createUser(
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  await requireAdmin();

  const parsed = createSchema.safeParse({
    name: formData.get("name") || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role") || "user",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { name, email, password, role } = parsed.data;
  const homeDistrictId = parseDistrictId(formData.get("homeDistrictId"));
  try {
    await db.insert(users).values({
      name: name ?? null,
      email,
      passwordHash: await hashPassword(password),
      role,
      homeDistrictId: await validDistrictId(homeDistrictId),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "An account with that email already exists." };
    }
    throw err;
  }

  revalidatePath("/admin/users");
  return { ok: true };
}

const updateSchema = z.object({
  name: nameField,
  email: emailField,
  role: roleField,
  // Optional — only changes the password when non-empty.
  password: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v === "" || v.length >= 8, "Password must be at least 8 characters.")
    .optional(),
});

export async function updateUser(
  userId: number,
  _prev: UserFormState,
  formData: FormData,
): Promise<UserFormState> {
  const admin = await requireAdmin();

  const parsed = updateSchema.safeParse({
    name: formData.get("name") || undefined,
    email: formData.get("email"),
    role: formData.get("role") || "user",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { name, email, role, password } = parsed.data;
  const homeDistrictId = parseDistrictId(formData.get("homeDistrictId"));

  // Don't let an admin lock themselves out by removing their own admin role.
  if (userId === admin.id && role !== "admin") {
    return { error: "You can't remove your own admin role." };
  }

  const values: Record<string, unknown> = {
    name: name ?? null,
    email,
    role,
    homeDistrictId: await validDistrictId(homeDistrictId),
  };
  if (password && password.length >= 8) {
    values.passwordHash = await hashPassword(password);
  }

  try {
    await db.update(users).set(values).where(eq(users.id, userId));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: "Another account already uses that email." };
    }
    throw err;
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function deleteUser(userId: number): Promise<void> {
  const admin = await requireAdmin();
  if (userId === admin.id) {
    throw new Error("You can't delete your own account.");
  }
  // Keep at least one admin around.
  const [{ admins }] = await db
    .select({ admins: sql<number>`count(*) filter (where role = 'admin')::int` })
    .from(users);
  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (target?.role === "admin" && admins <= 1) {
    throw new Error("Can't delete the last admin.");
  }

  await db.delete(users).where(eq(users.id, userId));
  revalidatePath("/admin/users");
}
