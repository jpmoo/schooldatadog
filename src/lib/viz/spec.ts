// The Visualizer chart spec — a declarative, AI-parseable envelope. Two layers:
//   data     — WHAT to plot (entities + fields = metric/year/subgroup combos)
//   encoding — HOW to plot it (Vega-Lite mark + channel→field mappings)
// Custom engines (matrix.*) share the same `data` layer and add `params`.
//
// Everything is plain JSON. The zod schema below validates any spec — whether a
// human typed it, the builder produced it, or (later) the AI generated it.

import { z } from "zod";

export const CHART_ENGINES = ["vega-lite", "matrix.correlation", "matrix.similarity"] as const;
export type ChartEngine = (typeof CHART_ENGINES)[number];

/** A named datapoint = metric code + subgroup + one or more years. */
export const fieldSchema = z.object({
  id: z.string(), // stable key referenced by encoding channels
  metric: z.string(), // metric code
  metricName: z.string().optional(),
  years: z.array(z.string()).min(1),
  subgroup: z.string().default("All Students"),
  label: z.string(),
  dataType: z.string().optional(),
  unit: z.string().nullish(),
});
export type FieldSpec = z.infer<typeof fieldSchema>;

/** Which entities to plot, with snapshot provenance so it can be refreshed. */
export const entitySourceSchema = z.object({
  ids: z.array(z.number()),
  level: z.enum(["district", "school", "both"]).default("district"),
  source: z
    .object({ kind: z.enum(["group", "view"]), id: z.number(), name: z.string() })
    .optional(),
});
export type EntitySource = z.infer<typeof entitySourceSchema>;

export const dataSpecSchema = z.object({
  entities: entitySourceSchema,
  fields: z.array(fieldSchema),
});
export type DataSpec = z.infer<typeof dataSpecSchema>;

/** A Vega-Lite-style encoding channel; `field` is a field id or a built-in
 *  column (entityName, county, entityType, year). */
export const channelSchema = z
  .object({
    field: z.string(),
    type: z.enum(["quantitative", "nominal", "ordinal", "temporal"]).optional(),
    title: z.string().optional(),
    aggregate: z.string().optional(),
    sort: z.unknown().optional(),
    scale: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type Channel = z.infer<typeof channelSchema>;

export const chartSpecSchema = z.object({
  version: z.literal(1),
  title: z.string().optional(),
  engine: z.enum(CHART_ENGINES),
  data: dataSpecSchema,
  // vega-lite layer
  mark: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  encoding: z.record(z.string(), channelSchema).optional(),
  transform: z.array(z.record(z.string(), z.unknown())).optional(),
  // custom engines (matrix.*)
  params: z.record(z.string(), z.unknown()).optional(),
  // presentation
  theme: z.enum(["app", "print"]).default("app"),
  colors: z.record(z.string(), z.string()).optional(), // series/value → hex override
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

/** Built-in (non-field) columns the resolver always provides. */
export const BUILTIN_COLUMNS = ["entityName", "county", "entityType", "year"] as const;

/** A fresh, empty spec for the blank-canvas start. */
export function blankSpec(): ChartSpec {
  return {
    version: 1,
    engine: "vega-lite",
    data: { entities: { ids: [], level: "district" }, fields: [] },
    mark: "bar",
    encoding: {},
    theme: "app",
  };
}

/** Validate an unknown value as a ChartSpec; returns the parsed spec or null. */
export function parseSpec(value: unknown): ChartSpec | null {
  const r = chartSpecSchema.safeParse(value);
  return r.success ? r.data : null;
}
