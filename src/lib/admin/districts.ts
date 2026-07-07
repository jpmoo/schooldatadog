import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";

export type DistrictOption = { id: number; name: string };

/** All district entities, alphabetized — for the home-district picker. */
export async function getDistricts(): Promise<DistrictOption[]> {
  return db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(eq(entities.type, "district"))
    .orderBy(asc(entities.name));
}
