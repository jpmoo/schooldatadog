import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, entities, users } from "@/db/schema";

/** The kinds of action we record. Used to build the admin filter dropdown. */
export const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  logout: "Signed out",
  "view.save": "Saved a view",
  "view.load": "Opened a view",
  "group.save": "Saved a group",
  "group.load": "Applied a group",
  "chart.save": "Saved a visualization",
  "chart.load": "Opened a visualization",
  "impersonate.start": "Logged in as a user",
  "impersonate.stop": "Returned to admin",
  "backup.create": "Created a database backup",
  "backup.error": "Database backup failed",
  "backup.schedule": "Changed the backup schedule",
};

/**
 * Record one activity-log entry. Best-effort: logging must never break the
 * action it accompanies, so failures are swallowed.
 */
export async function logActivity(
  userId: number | null,
  action: string,
  targetType: string | null = null,
  targetName: string | null = null,
): Promise<void> {
  try {
    await db.insert(activityLog).values({ userId, action, targetType, targetName });
  } catch {
    // ignore — an audit failure shouldn't surface to the user
  }
}

export type LogRow = {
  id: number;
  createdAt: Date;
  action: string;
  targetType: string | null;
  targetName: string | null;
  userName: string | null;
  userEmail: string | null;
  homeDistrict: string | null;
};

export type LogFilters = {
  userId?: number;
  districtId?: number;
  action?: string;
};

/** Recent log entries, joined to the user and their home district, filtered. */
export async function getActivityLog(filters: LogFilters, limit = 300): Promise<LogRow[]> {
  const conds = [];
  if (filters.userId) conds.push(eq(activityLog.userId, filters.userId));
  if (filters.districtId) conds.push(eq(users.homeDistrictId, filters.districtId));
  if (filters.action) conds.push(eq(activityLog.action, filters.action));

  const rows = await db
    .select({
      id: activityLog.id,
      createdAt: activityLog.createdAt,
      action: activityLog.action,
      targetType: activityLog.targetType,
      targetName: activityLog.targetName,
      userName: users.name,
      userEmail: users.email,
      homeDistrict: entities.name,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .leftJoin(entities, eq(entities.id, users.homeDistrictId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
  return rows;
}

/** Options for the admin filter controls. */
export async function getLogFilterOptions(): Promise<{
  users: { id: number; label: string }[];
  districts: { id: number; name: string }[];
  actions: { value: string; label: string }[];
}> {
  const [userRows, districtRows, actionRows] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(users.email),
    db
      .selectDistinct({ id: entities.id, name: entities.name })
      .from(users)
      .innerJoin(entities, eq(entities.id, users.homeDistrictId))
      .orderBy(entities.name),
    db.selectDistinct({ action: activityLog.action }).from(activityLog),
  ]);

  // Offer every known action type in the filter (plus any unknown ones already
  // logged), so actions like visualization save/open are always selectable —
  // even before the first such entry exists.
  const actionValues = Array.from(
    new Set([...Object.keys(ACTION_LABELS), ...actionRows.map((a) => a.action)]),
  ).sort();

  return {
    users: userRows.map((u) => ({ id: u.id, label: u.name ? `${u.name} (${u.email})` : u.email })),
    districts: districtRows.map((d) => ({ id: d.id, name: d.name })),
    actions: actionValues.map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a })),
  };
}
