import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth/session";
import { signup } from "@/lib/auth/actions";
import { AuthForm } from "../auth-form";

export default async function SignupPage() {
  const { user } = await getCurrentSession();
  if (user) redirect("/");

  // Signup exists only to bootstrap the very first (admin) account. Once any
  // account exists, self-signup is closed — admins create users in System Settings.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  if (count > 0) redirect("/login");

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
        Create the admin account
      </h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        This is the first account, so it becomes the system administrator.
      </p>
      <AuthForm mode="signup" action={signup} />
    </>
  );
}
