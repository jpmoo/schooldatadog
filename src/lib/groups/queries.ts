import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { entities, entityGroups } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";

export type GroupLite = { id: number; name: string; entityIds: number[] };

export type GroupMember = { id: number; name: string; type: "school" | "district" | "state" };

export type GroupWithEntities = {
  id: number;
  name: string;
  createdAt: Date;
  entities: GroupMember[];
};

/** The current user's saved groups (id/name/member-ids), newest name order. */
export async function getUserGroups(): Promise<GroupLite[]> {
  const user = await requireUser();
  const rows = await db
    .select({ id: entityGroups.id, name: entityGroups.name, entityIds: entityGroups.entityIds })
    .from(entityGroups)
    .where(eq(entityGroups.userId, user.id))
    .orderBy(asc(entityGroups.name));
  return rows.map((r) => ({ ...r, entityIds: r.entityIds ?? [] }));
}

/** The current user's groups with their (still-existing) member entities resolved. */
export async function getUserGroupsWithEntities(): Promise<GroupWithEntities[]> {
  const user = await requireUser();
  const rows = await db
    .select({
      id: entityGroups.id,
      name: entityGroups.name,
      entityIds: entityGroups.entityIds,
      createdAt: entityGroups.createdAt,
    })
    .from(entityGroups)
    .where(eq(entityGroups.userId, user.id))
    .orderBy(asc(entityGroups.name));

  const allIds = [...new Set(rows.flatMap((r) => r.entityIds ?? []))];
  const members = allIds.length
    ? await db
        .select({ id: entities.id, name: entities.name, type: entities.type })
        .from(entities)
        .where(inArray(entities.id, allIds))
    : [];
  const byId = new Map(members.map((m) => [m.id, m as GroupMember]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    entities: (r.entityIds ?? [])
      .map((id) => byId.get(id))
      .filter((m): m is GroupMember => Boolean(m))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
