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

  // Resolve our custom axis controls (axisMin/axisMax/majorStep/minorStep) on a
  // plain quantitative x/y axis into a scale domain + explicit tick positions.
  type AxisMeta = { lo?: number; hi?: number; major: number; minor: number; dMin?: number; dMax?: number };
  const axisMeta: Record<string, AxisMeta> = {};
  if (!faceted) {
    for (const ax of ["x", "y"] as const) {
      const d = (enc[ax] ?? {}) as Record<string, unknown>;
      if (d.type !== "quantitative" || "bin" in d) continue;
      const dMin = typeof d.axisMin === "number" ? d.axisMin : undefined;
      const dMax = typeof d.axisMax === "number" ? d.axisMax : undefined;
      const major = typeof d.majorStep === "number" ? d.majorStep : 0;
      const minor = typeof d.minorStep === "number" ? d.minorStep : 0;
      let dataLo: number | undefined;
      let dataHi: number | undefined;
      if (typeof d.field === "string" && !("aggregate" in d)) {
        const field = d.field;
        const nums = rows.map((r) => r[field]).filter((v): v is number => typeof v === "number");
        if (nums.length) {
          dataLo = Math.min(...nums, 0);
          dataHi = Math.max(...nums);
        }
      }
      axisMeta[ax] = { lo: dMin ?? dataLo, hi: dMax ?? dataHi, major, minor, dMin, dMax };
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
      delete rest.majorStep;
      delete rest.minorStep;
      const title = (typeof d.title === "string" ? d.title : undefined) ?? friendly;

      const meta = axisMeta[ch];
      let axis = (rest.axis && typeof rest.axis === "object" ? { ...(rest.axis as object) } : undefined) as
        | Record<string, unknown>
        | undefined;
      let scale = (rest.scale && typeof rest.scale === "object" ? { ...(rest.scale as object) } : undefined) as
        | Record<string, unknown>
        | undefined;
      if (meta) {
        if (meta.dMin !== undefined || meta.dMax !== undefined) {
          scale = scale ?? {};
          if (meta.dMin !== undefined) scale.domainMin = meta.dMin;
          if (meta.dMax !== undefined) scale.domainMax = meta.dMax;
        }
        if (meta.major > 0 && meta.lo !== undefined && meta.hi !== undefined && meta.hi > meta.lo) {
          const vals = enumerateTicks(meta.lo, meta.hi, meta.major);
          if (vals.length) {
            axis = axis ?? {};
            axis.values = vals;
            axis.grid = true;
          }
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

  // Minor gridlines: Vega-Lite has no native minor ticks, so draw evenly-spaced
  // rules between the (explicit or data-derived) axis bounds, sharing the scale.
  const minorLayers: Record<string, unknown>[] = [];
  if (!faceted) {
    for (const ax of ["x", "y"] as const) {
      const meta = axisMeta[ax];
      if (meta && meta.minor > 0 && meta.lo !== undefined && meta.hi !== undefined && meta.hi > meta.lo) {
        const vals = enumerateTicks(meta.lo, meta.hi, meta.minor);
        const domain: Record<string, unknown> = {};
        if (meta.dMin !== undefined) domain.domainMin = meta.dMin;
        if (meta.dMax !== undefined) domain.domainMax = meta.dMax;
        minorLayers.push({
          data: { values: vals.map((v) => ({ _g: v })) },
          mark: { type: "rule", stroke: "#cbd5e1", strokeWidth: 0.4, opacity: 0.6 },
          encoding: {
            [ax]: {
              field: "_g",
              type: "quantitative",
              axis: null,
              ...(Object.keys(domain).length ? { scale: domain } : {}),
            },
          },
        });
      }
    }
  }

  const base = { mark: spec.mark ?? "bar", encoding };
  const chartLayer = minorLayers.length ? { layer: [...minorLayers, base] } : base;

  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    // Faceted charts size to their content, so let them use their natural size
    // (the surrounding container scrolls); everything else fits the box exactly.
    ...(faceted ? {} : { width, height }),
    autosize: { type: "fit", contains: "padding" },
    background: "transparent",
    ...(spec.title ? { title: spec.title } : {}),
    data: { values: rows },
    ...(spec.transform ? { transform: spec.transform } : {}),
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
