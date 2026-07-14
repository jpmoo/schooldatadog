import type { MetricLite } from "@/lib/workshop/types";

export type CalcType =
  | "avg"
  | "wavg"
  | "sum"
  | "min"
  | "max"
  | "spread"
  | "difference"
  | "ratio"
  | "change"
  | "avgchange"
  | "cagr"
  | "slope"
  | "zscore"
  | "ordinal"
  | "index"
  | "gap"
  | "rank"
  | "similarity";

export const ALL_STUDENTS = "All Students";

export type DataColumn = {
  id: string;
  kind: "data";
  metric: MetricLite;
  year: string;
  subgroup: string; // demographic slice; "All Students" = no breakdown
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
  refEntityId?: number | null; // similarity / gap(entity): entity compared against
  direction?: "asc" | "desc"; // ordinal: is a low value (asc) or high value (desc) rank 1
  refMode?: "mean" | "entity" | "value"; // gap: what to measure the gap against
  refValue?: number | null; // gap(value): the target number
};

export type Column = DataColumn | CalcColumn;

export const CALC_LABELS: Record<CalcType, string> = {
  avg: "Average of selected columns",
  wavg: "Weighted average of selected columns",
  sum: "Sum of selected columns",
  min: "Minimum of selected columns",
  max: "Maximum of selected columns",
  spread: "Spread (max − min) of selected columns",
  difference: "Difference (first − second column)",
  ratio: "Ratio (first ÷ second column)",
  change: "Change across selected columns (first → last)",
  avgchange: "Average change, column to column",
  cagr: "Annual growth rate across years",
  slope: "Trend slope across years",
  zscore: "Z-score (standardized)",
  ordinal: "Rank position (1, 2, 3…)",
  index: "Composite index 0–100 (weighted)",
  gap: "Gap to a reference",
  rank: "Percentile ranking (weighted)",
  similarity: "Similarity to a district (weighted)",
};

/** Calc types whose weights matter. */
export const WEIGHTED_CALCS: CalcType[] = ["wavg", "index", "rank", "similarity"];

/** A sort level is an ordered list of keys (Excel-style multi-column sort). */
export type SortKey = { key: string; dir: "asc" | "desc" }; // key = column id or "name"

/**
 * A fully serializable snapshot of a workshop session — everything needed to
 * restore filters, sorts, and columns. Data-column *values* are intentionally
 * omitted (they're re-fetched on open); only the metric + year are stored.
 */
export type SavedDataColumn = {
  id: string;
  kind: "data";
  metric: MetricLite;
  year: string;
  subgroup: string;
};
export type SavedColumn = SavedDataColumn | CalcColumn;

export type SavedViewState = {
  year: string;
  viewMode: "districts" | "both" | "schools";
  // Selected counties (empty = all). Legacy saved views stored a single string;
  // read those with coerceCounties().
  county: string[];
  hidden: number[];
  collapsed: number[];
  districtSort: SortKey[];
  schoolSort: SortKey[];
  groupFilter: string;
  columns: SavedColumn[];
  hideEmpty?: boolean;
};

/** Read a persisted county filter (legacy single string, or the new array). */
export function coerceCounties(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((c): c is string => typeof c === "string" && c !== "");
  return typeof raw === "string" && raw ? [raw] : [];
}

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

  // Z-score: standardize the first source across the visible set.
  if (calc.calcType === "zscore") {
    const s = sources[0];
    const vals = visibleEntityIds.map((id) => dataVal(s, id)).filter((v): v is number => v !== null);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const std = Math.sqrt(vals.length ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length : 0);
    for (const id of visibleEntityIds) {
      const v = dataVal(s, id);
      out[id] = v === null || std === 0 ? null : (v - mean) / std;
    }
    return out;
  }

  // Ordinal rank: 1 = best. "desc" = high value is best, "asc" = low value is best.
  if (calc.calcType === "ordinal") {
    const s = sources[0];
    const desc = calc.direction !== "asc";
    for (const id of visibleEntityIds) {
      const v = dataVal(s, id);
      if (v === null) {
        out[id] = null;
        continue;
      }
      let better = 0;
      for (const oid of visibleEntityIds) {
        const ov = dataVal(s, oid);
        if (ov === null) continue;
        if (desc ? ov > v : ov < v) better += 1;
      }
      out[id] = better + 1;
    }
    return out;
  }

  // Composite index: min-max normalize each source to 0-100, weighted average.
  if (calc.calcType === "index") {
    const norm: Record<string, Record<number, number>> = {};
    for (const s of sources) {
      const vals = visibleEntityIds.map((id) => dataVal(s, id)).filter((v): v is number => v !== null);
      const lo = vals.length ? Math.min(...vals) : 0;
      const hi = vals.length ? Math.max(...vals) : 0;
      const map: Record<number, number> = {};
      for (const id of visibleEntityIds) {
        const v = dataVal(s, id);
        if (v === null) continue;
        map[id] = hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50;
      }
      norm[s.id] = map;
    }
    for (const id of visibleEntityIds) {
      let acc = 0, wsum = 0, any = false;
      for (const s of sources) {
        const nv = norm[s.id][id];
        if (nv === undefined) continue;
        const w = calc.weights[s.id] ?? 1;
        acc += nv * w;
        wsum += w;
        any = true;
      }
      out[id] = any && wsum > 0 ? acc / wsum : null;
    }
    return out;
  }

  // Gap-to-reference: precompute the reference value for the first source.
  let gapRef: number | null = null;
  if (calc.calcType === "gap") {
    const s = sources[0];
    const mode = calc.refMode ?? "mean";
    if (mode === "value") gapRef = typeof calc.refValue === "number" ? calc.refValue : null;
    else if (mode === "entity") gapRef = calc.refEntityId != null ? dataVal(s, calc.refEntityId) : null;
    else {
      const vals = visibleEntityIds.map((id) => dataVal(s, id)).filter((v): v is number => v !== null);
      gapRef = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
  }

  for (const id of visibleEntityIds) {
    const series = sources.map((s) => dataVal(s, id));
    const nums = series.filter((v): v is number => v !== null);
    const a0 = series[0] ?? null;
    const b0 = series[1] ?? null;
    switch (calc.calcType) {
      case "avg":
        out[id] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
        break;
      case "sum":
        out[id] = nums.length ? nums.reduce((a, b) => a + b, 0) : null;
        break;
      case "min":
        out[id] = nums.length ? Math.min(...nums) : null;
        break;
      case "max":
        out[id] = nums.length ? Math.max(...nums) : null;
        break;
      case "spread":
        out[id] = nums.length ? Math.max(...nums) - Math.min(...nums) : null;
        break;
      case "difference":
        out[id] = a0 === null || b0 === null ? null : a0 - b0;
        break;
      case "ratio":
        out[id] = a0 === null || b0 === null || b0 === 0 ? null : a0 / b0;
        break;
      case "wavg": {
        let acc = 0, wsum = 0;
        sources.forEach((s, i) => {
          const v = series[i];
          if (v === null) return;
          const w = calc.weights[s.id] ?? 1;
          acc += v * w;
          wsum += w;
        });
        out[id] = wsum > 0 ? acc / wsum : null;
        break;
      }
      case "gap":
        out[id] = a0 === null || gapRef === null ? null : a0 - gapRef;
        break;
      case "cagr": {
        const first = series[0], last = series[series.length - 1], n = series.length - 1;
        out[id] =
          first === null || last === null || n < 1 || first <= 0 || last <= 0
            ? null
            : (Math.pow(last / first, 1 / n) - 1) * 100;
        break;
      }
      case "slope": {
        const pts: [number, number][] = [];
        series.forEach((v, i) => v !== null && pts.push([i, v]));
        if (pts.length < 2) {
          out[id] = null;
          break;
        }
        const n = pts.length;
        const sx = pts.reduce((a, [x]) => a + x, 0);
        const sy = pts.reduce((a, [, y]) => a + y, 0);
        const sxx = pts.reduce((a, [x]) => a + x * x, 0);
        const sxy = pts.reduce((a, [x, y]) => a + x * y, 0);
        const denom = n * sxx - sx * sx;
        out[id] = denom === 0 ? null : (n * sxy - sx * sy) / denom;
        break;
      }
      case "change": {
        const first = series[0], last = series[series.length - 1];
        if (first === null || last === null) out[id] = null;
        else if (calc.asPercent) out[id] = first === 0 ? null : ((last - first) / first) * 100;
        else out[id] = last - first;
        break;
      }
      case "avgchange": {
        const diffs: number[] = [];
        for (let i = 1; i < series.length; i++) {
          const a = series[i - 1], b = series[i];
          if (a === null || b === null) continue;
          if (calc.asPercent) {
            if (a !== 0) diffs.push(((b - a) / a) * 100);
          } else diffs.push(b - a);
        }
        out[id] = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;
        break;
      }
      default:
        out[id] = null;
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
  const round2 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const signed = (n: number) => `${n > 0 ? "+" : ""}${round(n)}`;
  switch (col.calcType) {
    case "rank":
    case "index":
      return round(v);
    case "similarity":
      return `${round(v)}%`;
    case "ordinal":
      return Math.round(v).toLocaleString();
    case "cagr":
      return `${v > 0 ? "+" : ""}${round(v)}%`;
    case "zscore":
    case "ratio":
    case "slope":
      return round2(v);
    case "change":
    case "avgchange":
      return col.asPercent ? `${v > 0 ? "+" : ""}${round(v)}%` : signed(v);
    case "difference":
    case "gap":
      return signed(v);
    default:
      return round(v);
  }
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
