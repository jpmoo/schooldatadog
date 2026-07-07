import type { MetricLite } from "@/lib/workshop/types";

export type SortDir = "asc" | "desc";
export type CalcType = "avg" | "change" | "avgchange" | "rank";

export type DataColumn = {
  id: string;
  kind: "data";
  metric: MetricLite;
  year: string;
  values: Record<number, number | null>;
  sort: SortDir | null;
};

export type CalcColumn = {
  id: string;
  kind: "calc";
  calcType: CalcType;
  name: string;
  sourceIds: string[];
  weights: Record<string, number>;
  sort: SortDir | null;
};

export type Column = DataColumn | CalcColumn;

export const CALC_LABELS: Record<CalcType, string> = {
  avg: "Average of selected columns",
  change: "Change across selected columns (first → last)",
  avgchange: "Average change, column to column",
  rank: "Percentile ranking (weighted)",
};

function dataVal(col: DataColumn, entityId: number): number | null {
  const v = col.values[entityId];
  return v === undefined ? null : v;
}

/** Compute a calc column's value map over the currently visible entities. */
export function computeCalc(
  calc: CalcColumn,
  visibleEntityIds: number[],
  columnsById: Record<string, Column>,
): Record<number, number | null> {
  const sources = calc.sourceIds
    .map((id) => columnsById[id])
    .filter((c): c is DataColumn => c?.kind === "data");

  const out: Record<number, number | null> = {};
  if (sources.length === 0) {
    for (const id of visibleEntityIds) out[id] = null;
    return out;
  }

  if (calc.calcType === "rank") {
    // Percentile rank of each entity per source (among visible), weighted-averaged.
    const pct: Record<string, Record<number, number>> = {};
    for (const s of sources) {
      const sorted = visibleEntityIds
        .map((id) => dataVal(s, id))
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);
      const n = sorted.length;
      const map: Record<number, number> = {};
      for (const id of visibleEntityIds) {
        const v = dataVal(s, id);
        if (v === null || n === 0) continue;
        let lo = 0, hi = n; // count of values <= v (binary search)
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (sorted[mid] <= v) lo = mid + 1;
          else hi = mid;
        }
        map[id] = (lo / n) * 100;
      }
      pct[s.id] = map;
    }
    for (const id of visibleEntityIds) {
      let wsum = 0, acc = 0, any = false;
      for (const s of sources) {
        const p = pct[s.id][id];
        if (p === undefined) continue;
        const w = calc.weights[s.id] ?? 1;
        acc += p * w;
        wsum += w;
        any = true;
      }
      out[id] = any && wsum > 0 ? acc / wsum : null;
    }
    return out;
  }

  for (const id of visibleEntityIds) {
    const series = sources.map((s) => dataVal(s, id));
    const nums = series.filter((v): v is number => v !== null);
    if (calc.calcType === "avg") {
      out[id] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    } else if (calc.calcType === "change") {
      const first = series[0], last = series[series.length - 1];
      out[id] = first !== null && last !== null ? last - first : null;
    } else {
      // avgchange
      const diffs: number[] = [];
      for (let i = 1; i < series.length; i++) {
        const a = series[i - 1], b = series[i];
        if (a !== null && b !== null) diffs.push(b - a);
      }
      out[id] = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
    }
  }
  return out;
}

export function formatValue(
  v: number | null | undefined,
  dataType?: string,
  unit?: string | null,
): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const round = (n: number) =>
    Number.isInteger(n)
      ? n.toLocaleString()
      : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (dataType === "percent") return `${round(v)}%`;
  if (dataType === "currency") return `$${round(v)}`;
  if (unit === "%") return `${round(v)}%`;
  return round(v);
}
