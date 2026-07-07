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

  // Surface the "first account becomes admin" moment to the very first visitor.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  const isFirstAccount = count === 0;

  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-white">
        {isFirstAccount ? "Create the admin account" : "Create your account"}
      </h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        {isFirstAccount
          ? "This is the first account, so it becomes the system administrator with access to data-management tools."
          : "Sign up to start exploring school data."}
      </p>
      <AuthForm mode="signup" action={signup} />
    </>
  );
}
