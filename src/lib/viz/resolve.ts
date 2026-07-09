// Resolve a chart's data layer into a wide, tidy rowset that Vega-Lite (or a
// custom renderer) consumes. Runs client-side, reusing the workshop's
// getColumnValues server action. Each field becomes a named column; multi-year
// fields expand into one row per (entity, year).

import { getColumnValues } from "@/lib/workshop/actions";
import type { WorkshopEntity } from "@/lib/workshop/queries";
import { computeCalc, type Column } from "@/app/(app)/workshop/columns";
import type { CalcFieldSpec, DataSpec, FieldSpec } from "./spec";

export type Row = Record<string, string | number | null>;

/** Column metadata so the encoding UI can offer field ids + labels. */
export type ResolvedColumn = {
  id: string;
  label: string;
  kind: "field" | "builtin";
  dataType?: string;
};

export type ResolvedData = { rows: Row[]; columns: ResolvedColumn[] };

export async function resolveDataset(
  data: DataSpec,
  entitiesById: Map<number, WorkshopEntity>,
  homeDistrictId: number | null = null,
): Promise<ResolvedData> {
  const ids = new Set(data.entities.ids);
  const calc = data.calc ?? [];
  // Fields that exist only to feed a calc field must not drive the year axis: a
  // growth rate built from several single-year source columns would otherwise
  // multiply each entity into one row per source year (and double-count on bars).
  const calcSourceIds = new Set(calc.flatMap((c) => c.sourceIds));
  const years = [
    ...new Set(data.fields.filter((f) => !calcSourceIds.has(f.id)).flatMap((f) => f.years)),
  ].sort();

  // Fetch every (field, year) once → entityId → value.
  const values = new Map<string, Map<number, number | null>>();
  await Promise.all(
    data.fields.flatMap((f) =>
      f.years.map(async (yr) => {
        const rows = await getColumnValues(f.metric, yr, f.subgroup);
        const m = new Map<number, number | null>();
        for (const v of rows) if (ids.has(v.entityId)) m.set(v.entityId, v.value);
        values.set(key(f.id, yr), m);
      }),
    ),
  );

  const yearAxis = years.length ? years : [""];

  // Calculated fields are evaluated ONCE over the full set of source columns — a
  // growth rate (CAGR / change / slope) reads its sources as a series across
  // years, so it can't be computed one year at a time. Each source field maps to
  // a single value per entity (its value at the field's own year).
  const columnsById: Record<string, Column> = {};
  for (const f of data.fields) {
    const vals: Record<number, number | null> = {};
    for (const eid of data.entities.ids) {
      let v: number | null = null;
      for (const yr of f.years) {
        const got = values.get(key(f.id, yr))?.get(eid);
        if (got != null) v = got;
      }
      vals[eid] = v;
    }
    columnsById[f.id] = { id: f.id, kind: "data", values: vals } as unknown as Column;
  }
  const calcValues: Record<string, Record<number, number | null>> = {};
  for (const c of calc) {
    calcValues[c.id] = computeCalc(
      { ...c, kind: "calc" } as unknown as Parameters<typeof computeCalc>[0],
      data.entities.ids,
      columnsById,
    );
  }

  const rows: Row[] = [];
  for (const eid of data.entities.ids) {
    const ent = entitiesById.get(eid);
    if (!ent) continue;
    for (const yr of yearAxis) {
      const isHome =
        homeDistrictId != null && (eid === homeDistrictId || ent.parentDistrictId === homeDistrictId);
      const row: Row = {
        entityId: eid,
        entityName: ent.name,
        county: ent.county ?? "",
        entityType: ent.type,
        year: yr,
        homeDistrict: isHome ? "My district" : "Other",
      };
      for (const f of data.fields) {
        // A field contributes its value only for years it actually spans.
        row[f.id] = f.years.includes(yr) ? (values.get(key(f.id, yr))?.get(eid) ?? null) : null;
      }
      for (const c of calc) row[c.id] = calcValues[c.id]?.[eid] ?? null;
      rows.push(row);
    }
  }

  return { rows, columns: columnsOf(data.fields, calc, homeDistrictId != null) };
}

function key(fieldId: string, year: string) {
  return `${fieldId}::${year}`;
}

export function columnsOf(
  fields: FieldSpec[],
  calc: CalcFieldSpec[] = [],
  hasHomeDistrict = false,
): ResolvedColumn[] {
  return [
    { id: "entityName", label: "Entity name", kind: "builtin" },
    { id: "county", label: "County", kind: "builtin" },
    { id: "entityType", label: "Type", kind: "builtin" },
    { id: "year", label: "Year", kind: "builtin" },
    ...(hasHomeDistrict
      ? [{ id: "homeDistrict", label: "My district (highlight)", kind: "builtin" as const }]
      : []),
    ...fields.map(
      (f): ResolvedColumn => ({ id: f.id, label: f.label, kind: "field", dataType: f.dataType }),
    ),
    ...calc.map((c): ResolvedColumn => ({ id: c.id, label: `ƒ ${c.name}`, kind: "field" })),
  ];
}
