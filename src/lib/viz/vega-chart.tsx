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
  const encoding = Object.fromEntries(
    Object.entries(enc).map(([ch, def]) => {
      const d = (def ?? {}) as Record<string, unknown>;
      const friendly = typeof d.field === "string" ? labels[d.field] : undefined;
      return [
        ch,
        {
          ...d,
          title: d.title ?? friendly ?? d.field,
          ...(hideLegend && LEGEND_CHANNELS.has(ch) ? { legend: null } : {}),
        },
      ];
    }),
  );
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
    mark: spec.mark ?? "bar",
    encoding,
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
