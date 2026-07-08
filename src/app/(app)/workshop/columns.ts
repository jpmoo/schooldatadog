import type { MetricLite } from "@/lib/workshop/types";

export type CalcType = "avg" | "change" | "avgchange" | "rank" | "similarity";

export type DataColumn = {
  id: string;
  kind: "data";
  metric: MetricLite;
  year: string;
  values: Record<number, number | null>;
};

export type CalcColumn = {
  id: string;
  kind: "calc";
  calcType: CalcType;
  name: string;
  sourceIds: string[];
  weights: Record<string, number>;
  asPercent: boolean; // change / avgchange: show as % change instead of raw
  refEntityId?: number | null; // similarity: entity every row is compared against
};

export type Column = DataColumn | CalcColumn;

export const CALC_LABELS: Record<CalcType, string> = {
  avg: "Average of selected columns",
  change: "Change across selected columns (first → last)",
  avgchange: "Average change, column to column",
  rank: "Percentile ranking (weighted)",
  similarity: "Similarity to a district (weighted)",
};

/** A sort level is an ordered list of keys (Excel-style multi-column sort). */
export type SortKey = { key: string; dir: "asc" | "desc" }; // key = column id or "name"

function dataVal(col: DataColumn, entityId: number): number | null {
  const v = col.values[entityId];
  return v === undefined ? null : v;
}

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
        let lo = 0, hi = n;
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

  if (calc.calcType === "similarity") {
    const ref = calc.refEntityId;
    if (ref == null || !visibleEntityIds.includes(ref)) {
      for (const id of visibleEntityIds) out[id] = null;
      return out;
    }
    // z-score normalize each source across the visible set, then weighted
    // Euclidean distance to the reference; map distance → 0-100 similarity.
    const stats = sources.map((s) => {
      const vals = visibleEntityIds
        .map((id) => dataVal(s, id))
        .filter((v): v is number => v !== null);
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const variance = vals.length
        ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
        : 0;
      return { s, mean, std: Math.sqrt(variance), w: calc.weights[s.id] ?? 1 };
    });
    const dist: Record<number, number | null> = {};
    for (const id of visibleEntityIds) {
      let acc = 0, wsum = 0;
      for (const { s, mean, std, w } of stats) {
        if (std === 0 || w <= 0) continue;
        const ve = dataVal(s, id);
        const vr = dataVal(s, ref);
        if (ve === null || vr === null) continue;
        const dz = (ve - mean) / std - (vr - mean) / std;
        acc += w * dz * dz;
        wsum += w;
      }
      dist[id] = wsum > 0 ? Math.sqrt(acc / wsum) : null;
    }
    const dmax = Math.max(0, ...Object.values(dist).filter((d): d is number => d !== null));
    for (const id of visibleEntityIds) {
      const d = dist[id];
      out[id] = d === null ? null : dmax === 0 ? 100 : 100 * (1 - d / dmax);
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
      if (first === null || last === null) out[id] = null;
      else if (calc.asPercent) out[id] = first === 0 ? null : ((last - first) / first) * 100;
      else out[id] = last - first;
    } else {
      // avgchange
      const diffs: number[] = [];
      for (let i = 1; i < series.length; i++) {
        const a = series[i - 1], b = series[i];
        if (a === null || b === null) continue;
        if (calc.asPercent) {
          if (a !== 0) diffs.push(((b - a) / a) * 100);
        } else diffs.push(b - a);
      }
      out[id] = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
    }
  }
  return out;
}

/** Format a data value using its metric's type/unit. */
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
  if (dataType === "percent" || unit === "%") return `${round(v)}%`;
  if (dataType === "currency") return `$${round(v)}`;
  return round(v);
}

/** Format a calculated-column value. */
export function formatCalc(col: CalcColumn, v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const round = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (col.calcType === "rank") return round(v);
  if (col.calcType === "similarity") return `${round(v)}%`;
  if ((col.calcType === "change" || col.calcType === "avgchange") && col.asPercent)
    return `${v > 0 ? "+" : ""}${round(v)}%`;
  return `${v > 0 && (col.calcType === "change" || col.calcType === "avgchange") ? "+" : ""}${round(v)}`;
}

/** Compare two entities by an ordered list of sort keys; nulls sort last. */
export function compareBySortKeys(
  keys: SortKey[],
  valueOf: (key: string, entityId: number) => number | string | null,
  a: { id: number; name: string },
  b: { id: number; name: string },
): number {
  for (const k of keys) {
    const va = k.key === "name" ? a.name : valueOf(k.key, a.id);
    const vb = k.key === "name" ? b.name : valueOf(k.key, b.id);
    const an = va === null || va === undefined;
    const bn = vb === null || vb === undefined;
    if (an && bn) continue;
    if (an) return 1; // nulls last, regardless of direction
    if (bn) return -1;
    let cmp: number;
    if (typeof va === "string" || typeof vb === "string")
      cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
    else cmp = (va as number) - (vb as number);
    if (cmp !== 0) return k.dir === "asc" ? cmp : -cmp;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}
