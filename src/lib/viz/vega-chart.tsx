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
 * read nicely; an explicit channel `title` always wins. */
function toVegaLite(spec: ChartSpec, rows: Row[], labels: Record<string, string>) {
  const enc = spec.encoding ?? {};
  const encoding = Object.fromEntries(
    Object.entries(enc).map(([ch, def]) => {
      const d = (def ?? {}) as Record<string, unknown>;
      const friendly = typeof d.field === "string" ? labels[d.field] : undefined;
      return [ch, { ...d, title: d.title ?? friendly ?? d.field }];
    }),
  );
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v6.json",
    width: "container",
    height: 420,
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
  onView,
}: {
  spec: ChartSpec;
  rows: Row[];
  labels?: Record<string, string>;
  onView?: (view: View | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep the latest onView without making it an effect dependency — otherwise a
  // fresh inline callback each render would re-run the embed effect constantly
  // and let overlapping async embeds race (a stale one could win).
  const onViewRef = useRef(onView);
  onViewRef.current = onView;

  useEffect(() => {
    let cancelled = false;
    let finalize: (() => void) | undefined;
    (async () => {
      const el = ref.current;
      if (!el) return;
      setError(null);
      try {
        const embed = (await import("vega-embed")).default;
        if (cancelled) return;
        const res = await embed(el, toVegaLite(spec, rows, labels) as never, {
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
  }, [spec, rows, labels]);

  return (
    <div className="w-full">
      <div ref={ref} className="w-full" />
      {error && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
