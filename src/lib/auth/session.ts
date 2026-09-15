import "server-only";
import { createHash, randomBytes } from "crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type UserRole } from "@/db/schema";

const COOKIE_NAME = "sdd_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Scope the cookie to the app's base path so it isn't sent to (or clobbered by)
 * sibling apps sharing the same host behind the reverse proxy. Matches
 * next.config's basePath; defaults to "/" at the root.
 */
function cookiePath(): string {
  return process.env.BASE_PATH?.trim().replace(/\/+$/, "") || "/";
}

/**
 * Whether to mark the session cookie Secure (HTTPS-only). Defaults to on in
 * production. An HTTP-only deployment — a plain-HTTP box with no TLS in front —
 * MUST set COOKIE_SECURE=false, or the browser drops the cookie on the insecure
 * origin and every request looks logged-out (redirect back to /login). Only turn
 * it off when the transport is otherwise protected (a private LAN, or a
 * WireGuard/Tailscale network); over the open internet a cleartext session token
 * can be sniffed.
 */
function cookieSecure(): boolean {
  const v = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return process.env.NODE_ENV === "production";
}

export type SessionUser = {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
};

export type SessionResult =
  | { session: { id: string; expiresAt: Date; impersonatorId: number | null }; user: SessionUser }
  | { session: null; user: null };

/** SHA-256 of the opaque token; this is what we persist as the session id. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Create a new session for `userId` and set the httpOnly cookie.
 * Must be called from a Server Action or Route Handler (it writes a cookie).
 */
export async function createSession(userId: number, impersonatorId: number | null = null): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({ id, userId, impersonatorId, expiresAt });

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: cookiePath(),
    expires: expiresAt,
  });
}

/**
 * Resolve the current session + user from the request cookie. Cached per
 * request so repeated calls in one render don't re-query. Reading only —
 * safe to call from Server Components.
 */
export const getCurrentSession = cache(async (): Promise<SessionResult> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return { session: null, user: null };

  const sessionId = hashToken(token);
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      impersonatorId: sessions.impersonatorId,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return { session: null, user: null };

  if (Date.now() >= row.expiresAt.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return { session: null, user: null };
  }

  return {
    session: { id: row.sessionId, expiresAt: row.expiresAt, impersonatorId: row.impersonatorId },
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      role: row.role,
    },
  };
});

/** If the current session is an admin impersonating someone, the admin's id. */
export async function getImpersonatorId(): Promise<number | null> {
  const { session } = await getCurrentSession();
  return session?.impersonatorId ?? null;
}

/** Invalidate the current session and clear the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
    store.set(COOKIE_NAME, "", { path: cookiePath(), maxAge: 0 });
  }
}
