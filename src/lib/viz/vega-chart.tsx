"use client";

import { useEffect, useRef, useState } from "react";
import type { View } from "vega";
import type { ChartSpec } from "./spec";
import type { Row } from "./resolve";

// App vs. print colour ranges; charts render on a white card so they read the
// same in dark mode and are print-ready.
function themeConfig(theme: ChartSpec["theme"]) {
  const font = "inherit";
  const category =
    theme === "print"
      ? ["#0f172a", "#475569", "#94a3b8", "#1e293b", "#cbd5e1", "#334155"]
      : ["#6366f1", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#14b8a6", "#ef4444"];
  return {
    font,
    background: "transparent",
    axis: {
      labelFont: font,
      titleFont: font,
      labelColor: "#64748b",
      titleColor: "#334155",
      gridColor: "#f1f5f9",
      domainColor: "#cbd5e1",
      tickColor: "#cbd5e1",
    },
    legend: { labelFont: font, titleFont: font, labelColor: "#334155", titleColor: "#334155" },
    title: { font, color: "#0f172a", fontSize: 16, anchor: "start" as const },
    // Single-series marks use the palette's primary, so a "recolour my district"
    // (whose fallback is that same colour) leaves everyone else unchanged.
    mark: { color: category[0] },
    range: { category },
    view: { stroke: "transparent" },
  };
}

/** Tick positions lo, lo+step, … up to (and including) hi. Capped for safety. */
function enumerateTicks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  const count = Math.floor((hi - lo) / step + 1e-9);
  for (let i = 0; i <= count && out.length < 2000; i++) {
    out.push(Number((lo + i * step).toFixed(6)));
  }
  return out;
}

/** Compile a ChartSpec's encoding layer + resolved rows into a Vega-Lite spec.
 * `labels` maps a field id / built-in to its friendly name so axes and legends
 * read nicely; an explicit channel `title` always wins. `width`/`height` are the
 * pixel size to render at (measured container size × zoom). */
function toVegaLite(
  spec: ChartSpec,
  rows: Row[],
  labels: Record<string, string>,
  width: number,
  height: number,
) {
  const enc = spec.encoding ?? {};
  const faceted = "column" in enc || "row" in enc || "facet" in enc;
  const hideLegend = spec.showLegend === false;
  const LEGEND_CHANNELS = new Set(["color", "size", "shape", "opacity", "fill", "stroke"]);
  const markStr = typeof spec.mark === "string" ? spec.mark : "bar";
  // Only bar/area anchor their value axis at 0; scatter/line use the data range.
  const zeroBased = markStr === "bar" || markStr === "area";

  // Resolve our custom axis controls (axisMin/axisMax/interval) on a plain
  // quantitative x/y axis into a scale domain + explicit, evenly-spaced ticks.
  type AxisMeta = { lo?: number; hi?: number; interval: number; dMin?: number; dMax?: number };
  const axisMeta: Record<string, AxisMeta> = {};
  if (!faceted) {
    for (const ax of ["x", "y"] as const) {
      const d = (enc[ax] ?? {}) as Record<string, unknown>;
      if (d.type !== "quantitative" || "bin" in d) continue;
      const dMin = typeof d.axisMin === "number" ? d.axisMin : undefined;
      const dMax = typeof d.axisMax === "number" ? d.axisMax : undefined;
      const interval = typeof d.interval === "number" ? d.interval : 0;
      let dataLo: number | undefined;
      let dataHi: number | undefined;
      if (typeof d.field === "string" && !("aggregate" in d)) {
        const field = d.field;
        const nums = rows.map((r) => r[field]).filter((v): v is number => typeof v === "number");
        if (nums.length) {
          dataLo = zeroBased ? Math.min(...nums, 0) : Math.min(...nums);
          dataHi = Math.max(...nums);
        }
      }
      axisMeta[ax] = { lo: dMin ?? dataLo, hi: dMax ?? dataHi, interval, dMin, dMax };
    }
  }

  const encoding = Object.fromEntries(
    Object.entries(enc).map(([ch, def]) => {
      const d = (def ?? {}) as Record<string, unknown>;
      const friendly = typeof d.field === "string" ? labels[d.field] : undefined;
      // Strip our own keys; they're never valid Vega-Lite channel properties.
      const rest = { ...d };
      delete rest.axisMin;
      delete rest.axisMax;
      delete rest.interval;
      const title = (typeof d.title === "string" ? d.title : undefined) ?? friendly;

      const meta = axisMeta[ch];
      let axis = (rest.axis && typeof rest.axis === "object" ? { ...(rest.axis as object) } : undefined) as
        | Record<string, unknown>
        | undefined;
      let scale = (rest.scale && typeof rest.scale === "object" ? { ...(rest.scale as object) } : undefined) as
        | Record<string, unknown>
        | undefined;
      if (meta) {
        // Domain — ignore an inverted (min ≥ max) range, which Vega rejects.
        const inverted = meta.dMin !== undefined && meta.dMax !== undefined && meta.dMin >= meta.dMax;
        if (!inverted && (meta.dMin !== undefined || meta.dMax !== undefined)) {
          scale = scale ?? {};
          if (meta.dMin !== undefined) scale.domainMin = meta.dMin;
          if (meta.dMax !== undefined) scale.domainMax = meta.dMax;
        }
        // Ticks — exact positions for a sane count; fall back to a tick count for
        // very fine intervals so we never flood the axis with thousands of ticks.
        if (meta.interval > 0 && meta.lo !== undefined && meta.hi !== undefined && meta.hi > meta.lo) {
          const n = (meta.hi - meta.lo) / meta.interval;
          axis = axis ?? {};
          if (n <= 60) axis.values = enumerateTicks(meta.lo, meta.hi, meta.interval);
          else axis.tickCount = Math.min(Math.round(n), 100);
          axis.grid = true;
        }
      }
      return [
        ch,
        {
          ...rest,
          ...(title ? { title } : {}),
          ...(axis ? { axis } : {}),
          ...(scale ? { scale } : {}),
          ...(hideLegend && LEGEND_CHANNELS.has(ch) ? { legend: null } : {}),
        },
      ];
    }),
  );

  // The default fill for un-highlighted marks — the theme's primary colour, so a
  // "recolour" highlight leaves everyone else looking normal (not faded/grey).
  const themePrimary = spec.theme === "print" ? "#0f172a" : "#6366f1";
  const hasHomeCond = (o: unknown) => {
    const c = (o as Record<string, unknown> | undefined)?.condition as Record<string, unknown> | undefined;
    return typeof c?.test === "string" && c.test.includes("homeDistrict");
  };
  const e = encoding as Record<string, unknown>;
  const xd = (enc.x ?? {}) as Record<string, unknown>;
  const yd = (enc.y ?? {}) as Record<string, unknown>;
  const isHistogram = markStr === "bar" && "bin" in xd && yd.aggregate === "count";

  // Outline (stroke) highlight is meaningless on line/area/tick marks (stroke is
  // the mark itself), so drop it there rather than render invisible lines.
  if (markStr === "line" || markStr === "area" || markStr === "tick" || markStr === "point") {
    if (hasHomeCond(e.stroke)) delete e.stroke;
    if (hasHomeCond(e.strokeWidth)) delete e.strokeWidth;
  }

  // A "recolour" highlight (colour condition with a plain value, no field) should
  // leave the other marks in the normal colour, not a placeholder grey.
  const colorDef = e.color as Record<string, unknown> | undefined;
  if (!isHistogram && hasHomeCond(colorDef) && typeof colorDef?.field !== "string") {
    e.color = { ...colorDef, value: themePrimary };
  }

  // Histogram highlight: on an aggregated (binned + count) bar a per-datum
  // highlight can't work, so colour the whole bin that contains the home
  // district by max(isHome). Others keep the normal colour.
  const extraTransform: Record<string, unknown>[] = [];
  const hlActive = ["opacity", "stroke", "color"].some((k) => hasHomeCond(enc[k]));
  if (isHistogram && hlActive) {
    const colorCond = ((enc.color ?? {}) as Record<string, unknown>).condition as
      | Record<string, unknown>
      | undefined;
    const hlColor = typeof colorCond?.value === "string" ? colorCond.value : "#f59e0b";
    delete e.opacity;
    delete e.stroke;
    delete e.strokeWidth;
    e.color = {
      aggregate: "max",
      field: "_home",
      type: "ordinal",
      scale: { domain: [0, 1], range: [themePrimary, hlColor] },
      legend: null,
    };
    extraTransform.push({ calculate: "datum.homeDistrict === 'My district' ? 1 : 0", as: "_home" });
  }

  // Point / marker style (Bubble type + size) for scatter + line marks.
  const bubbleStyle = () => {
    const p = spec.points ?? {};
    const bubble = typeof p.bubble === "string" ? p.bubble : "";
    const size = typeof p.size === "number" ? p.size : undefined;
    let shape: string | undefined;
    let filled: boolean | undefined;
    if (bubble && bubble !== "none") {
      const [sh, fill] = bubble.split("-");
      shape = sh;
      filled = fill === "filled";
    }
    return { bubble, shape, filled, size };
  };

  let mark: unknown = spec.mark ?? "bar";
  if (markStr === "point") {
    const { bubble, shape, filled, size } = bubbleStyle();
    if (bubble === "none") mark = { type: "point", opacity: 0 };
    else if (shape || filled !== undefined || size !== undefined) {
      mark = {
        type: "point",
        ...(shape ? { shape } : {}),
        ...(filled !== undefined ? { filled } : {}),
        ...(size !== undefined ? { size } : {}),
      };
    }
  } else if (markStr === "line") {
    const { bubble, shape, filled, size } = bubbleStyle();
    const point =
      bubble === "none" || bubble === ""
        ? false
        : {
            ...(shape ? { shape } : {}),
            ...(filled !== undefined ? { filled } : {}),
            ...(size !== undefined ? { size } : {}),
          };
    mark = { type: "line", point };
  }

  // Value labels: a text layer positioned at each mark (positional channels only,
  // so the labels don't inherit the series colour/size).
  const labelLayers: Record<string, unknown>[] = [];
  if (spec.dataLabels && !faceted && ["bar", "point", "line", "area", "tick"].includes(markStr)) {
    const encRec = encoding as Record<string, unknown>;
    const yd2 = encRec.y as Record<string, unknown> | undefined;
    if (yd2) {
      const posEnc: Record<string, unknown> = {};
      for (const k of ["x", "y", "xOffset"]) if (encRec[k]) posEnc[k] = encRec[k];
      const textDef: Record<string, unknown> = { type: "quantitative", format: ".0f" };
      if (typeof yd2.field === "string") textDef.field = yd2.field;
      if (typeof yd2.aggregate === "string") textDef.aggregate = yd2.aggregate;
      labelLayers.push({
        mark: { type: "text", dy: -7, fontSize: 9, color: "#334155" },
        encoding: { ...posEnc, text: textDef },
      });
    }
  }

  const base = { mark, encoding };
  const chartLayer = labelLayers.length ? { layer: [base, ...labelLayers] } : base;

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    // Faceted charts size to their content, so let them use their natural size
    // (the surrounding container scrolls); everything else fits the box exactly.
    ...(faceted ? {} : { width, height }),
    autosize: { type: "fit", contains: "padding" },
    background: "transparent",
    ...(spec.title ? { title: spec.title } : {}),
    data: { values: rows },
    ...(spec.transform || extraTransform.length
      ? { transform: [...(spec.transform ?? []), ...extraTransform] }
      : {}),
    ...chartLayer,
  };
}

export function VegaChart({
  spec,
  rows,
  labels = {},
  zoom = 1,
  onView,
}: {
  spec: ChartSpec;
  rows: Row[];
  labels?: Record<string, string>;
  zoom?: number;
  onView?: (view: View | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Keep the latest onView without making it an effect dependency — otherwise a
  // fresh inline callback each render would re-run the embed effect constantly
  // and let overlapping async embeds race (a stale one could win).
  const onViewRef = useRef(onView);
  onViewRef.current = onView;

  // Track the available area so the chart always fits inside its box (and re-fits
  // when a panel opens/closes or the window resizes).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      setSize((s) => (Math.abs(s.w - w) > 2 || Math.abs(s.h - h) > 2 ? { w, h } : s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (size.w < 40 || size.h < 40) return;
    let cancelled = false;
    let finalize: (() => void) | undefined;
    (async () => {
      const el = ref.current;
      if (!el) return;
      setError(null);
      try {
        const embed = (await import("vega-embed")).default;
        if (cancelled) return;
        // Fit the measured box (minus a little padding) × zoom.
        const w = Math.max(80, Math.round((size.w - 8) * zoom));
        const h = Math.max(80, Math.round((size.h - 8) * zoom));
        const res = await embed(el, toVegaLite(spec, rows, labels, w, h) as never, {
          renderer: "svg",
          actions: false,
          config: themeConfig(spec.theme) as never,
        });
        if (cancelled) {
          res.finalize();
          return;
        }
        finalize = res.finalize;
        onViewRef.current?.(res.view);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not render this chart.");
          onViewRef.current?.(null);
        }
      }
    })();
    return () => {
      cancelled = true;
      onViewRef.current?.(null);
      finalize?.();
    };
  }, [spec, rows, labels, size.w, size.h, zoom]);

  return (
    <div ref={wrapRef} className="h-full w-full overflow-auto">
      <div ref={ref} />
      {error && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
