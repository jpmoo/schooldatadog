"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "./password";
import { createSession, destroySession } from "./session";

export type AuthState = { error?: string } | undefined;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(200, "Password is too long."),
});

const signupSchema = credentials.extend({
  name: z.string().trim().max(255).optional(),
});

export async function signup(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { email, password, name } = parsed.data;
  const passwordHash = await hashPassword(password);

  let newUserId: number;
  try {
    // Transaction so the "is this the very first account?" check and the insert
    // are atomic — the first successful signup becomes the system admin.
    newUserId = await db.transaction(async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(users);
      const role = count === 0 ? "admin" : "user";

      const [row] = await tx
        .insert(users)
        .values({ email, passwordHash, name: name ?? null, role })
        .returning({ id: users.id });
      return row.id;
    });
  } catch (err: unknown) {
    // 23505 = unique_violation (email already taken).
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      return { error: "An account with that email already exists." };
    }
    throw err;
  }

  await createSession(newUserId);
  redirect("/");
}

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Invalid email or password." };
  }

  const { email, password } = parsed.data;
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Same generic error whether the email is unknown or the password is wrong.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "Invalid email or password." };
  }

  await createSession(user.id);
  redirect("/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
