import "server-only";
import { asc, desc, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { entities, facts } from "@/db/schema";

export type WorkshopEntity = {
  id: number;
  name: string;
  type: "school" | "district";
  county: string | null;
  parentDistrictId: number | null;
};

/**
 * School years that actually carry data, newest first. A year is only included
 * if it has at least one fact with a value — years present only as empty /
 * placeholder rows (e.g. a not-yet-published 2025-2026) are skipped.
 */
export async function getYears(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ y: facts.schoolYear })
    .from(facts)
    .where(or(isNotNull(facts.valueNumeric), isNotNull(facts.valueText)))
    .orderBy(desc(facts.schoolYear));
  return rows.map((r) => r.y);
}

/** Counties that have entities, alphabetized. */
export async function getCounties(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ c: entities.county })
    .from(entities)
    .where(isNotNull(entities.county))
    .orderBy(asc(entities.county));
  return rows.map((r) => r.c).filter((c): c is string => Boolean(c));
}

/** All real schools & districts (aggregates already excluded). */
export async function getEntities(): Promise<WorkshopEntity[]> {
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      county: entities.county,
      parentDistrictId: entities.parentDistrictId,
    })
    .from(entities)
    .where(inArray(entities.type, ["school", "district"]))
    .orderBy(asc(entities.name));
  return rows as WorkshopEntity[];
}
