import "server-only";
import { redirect } from "next/navigation";
import { getCurrentSession, type SessionUser } from "./session";

/** Require a logged-in user, or redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  const { user } = await getCurrentSession();
  if (!user) redirect("/login");
  return user;
}

/** Require an admin, or redirect (to /login if anon, to / if a plain user). */
export async function requireAdmin(): Promise<SessionUser> {
  const { user } = await getCurrentSession();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return user;
}
