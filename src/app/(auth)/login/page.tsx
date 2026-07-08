import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { login } from "@/lib/auth/actions";
import { AuthForm } from "../auth-form";

export default async function LoginPage() {
  const { user } = await getCurrentSession();
  if (user) redirect("/");

  // First run: no accounts yet — send the first visitor to create the admin.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  if (count === 0) redirect("/signup");

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
        Sign in
      </h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        Welcome.
      </p>
      <AuthForm mode="login" action={login} />
    </>
  );
}
