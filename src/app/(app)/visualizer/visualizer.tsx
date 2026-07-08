"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { View } from "vega";
import type { GroupLite } from "@/lib/groups/queries";
import { searchMetrics } from "@/lib/workshop/actions";
import type { WorkshopEntity } from "@/lib/workshop/queries";
import type { MetricLite } from "@/lib/workshop/types";
import { createChart, updateChart } from "@/lib/charts/actions";
import { columnsOf, resolveDataset, type Row } from "@/lib/viz/resolve";
import { blankSpec, type ChartSpec, type FieldSpec } from "@/lib/viz/spec";
import { VegaChart } from "@/lib/viz/vega-chart";

const MARKS = ["bar", "line", "point", "area", "tick", "rect"] as const;
const CHANNELS = ["x", "y", "color", "xOffset", "column", "row", "size"] as const;
const STD_SUBGROUPS = [
  "All Students", "Female", "Male",
  "American Indian or Alaska Native", "Asian or Native Hawaiian/Other Pacific Islander",
  "Black or African American", "Hispanic or Latino", "Multiracial", "White",
  "Economically Disadvantaged", "Not Economically Disadvantaged",
  "Students with Disabilities", "Students without Disabilities",
  "English Language Learners",
];

let fieldSeq = 0;
const newFieldId = () => `f${++fieldSeq}_${Math.round(performance.now())}`;

export function Visualizer({
  years,
  entities,
  initialMetrics,
  groups,
  demographicMetrics,
  initialChart,
}: {
  years: string[];
  entities: WorkshopEntity[];
  initialMetrics: MetricLite[];
  groups: GroupLite[];
  demographicMetrics: string[];
  initialChart: { id: number; name: string; spec: ChartSpec } | null;
}) {
  const entitiesById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const demoSet = useMemo(() => new Set(demographicMetrics), [demographicMetrics]);

  const [spec, setSpec] = useState<ChartSpec>(initialChart?.spec ?? blankSpec());
  const [chartId, setChartId] = useState<number | null>(initialChart?.id ?? null);
  const [name, setName] = useState(initialChart?.name ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [resolving, setResolving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);

  // Metric search
  const [year, setYear] = useState(years[0] ?? "");
  const [query, setQuery] = useState("");
  const [metrics, setMetrics] = useState<MetricLite[]>(initialMetrics);
  const [, startSearch] = useTransition();
  useEffect(() => {
    const t = setTimeout(() => startSearch(async () => setMetrics(await searchMetrics(query, year))), 250);
    return () => clearTimeout(t);
  }, [query, year]);

  // Entity source
  const [entMode, setEntMode] = useState<"districts" | "schools" | "group">("districts");
  const [groupId, setGroupId] = useState<string>("");
  const [county, setCounty] = useState("");
  const counties = useMemo(
    () => [...new Set(entities.map((e) => e.county).filter(Boolean))].sort() as string[],
    [entities],
  );

  // Whenever the entity source changes, recompute data.entities.ids.
  useEffect(() => {
    let ids: number[];
    let source: ChartSpec["data"]["entities"]["source"];
    if (entMode === "group") {
      const g = groups.find((x) => String(x.id) === groupId);
      ids = g ? g.entityIds : [];
      source = g ? { kind: "group", id: g.id, name: g.name } : undefined;
    } else {
      const type = entMode === "schools" ? "school" : "district";
      ids = entities.filter((e) => e.type === type && (!county || e.county === county)).map((e) => e.id);
    }
    const level = entMode === "schools" ? "school" : entMode === "districts" ? "district" : "both";
    setSpec((s) => ({ ...s, data: { ...s.data, entities: { ids, level, source } } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entMode, groupId, county]);

  // Resolve the dataset whenever the data layer changes.
  const dataKey = JSON.stringify(spec.data);
  useEffect(() => {
    let live = true;
    if (spec.data.fields.length === 0 || spec.data.entities.ids.length === 0) {
      setRows([]);
      return;
    }
    setResolving(true);
    resolveDataset(spec.data, entitiesById).then((res) => {
      if (live) {
        setRows(res.rows);
        setResolving(false);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // Keep the JSON editor in sync when not actively editing it.
  useEffect(() => {
    if (!showJson) setJsonText(JSON.stringify(spec, null, 2));
  }, [spec, showJson]);

  const columns = useMemo(() => columnsOf(spec.data.fields), [spec.data.fields]);

  // ── field ops ──
  function addField(m: MetricLite) {
    const f: FieldSpec = {
      id: newFieldId(),
      metric: m.code,
      metricName: m.name,
      years: [year],
      subgroup: "All Students",
      label: m.name,
      dataType: m.dataType,
      unit: m.unit,
    };
    setSpec((s) => {
      const fields = [...s.data.fields, f];
      // First field on a bar chart: seed a sensible default encoding.
      const enc =
        Object.keys(s.encoding ?? {}).length === 0
          ? { x: { field: "entityName", type: "nominal" as const, sort: "-y" }, y: { field: f.id, type: "quantitative" as const } }
          : s.encoding;
      return { ...s, data: { ...s.data, fields }, encoding: enc };
    });
  }
  const removeField = (id: string) =>
    setSpec((s) => ({ ...s, data: { ...s.data, fields: s.data.fields.filter((f) => f.id !== id) } }));
  const patchField = (id: string, patch: Partial<FieldSpec>) =>
    setSpec((s) => ({
      ...s,
      data: { ...s.data, fields: s.data.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) },
    }));

  // ── encoding ops ──
  const setChannel = (ch: string, field: string) =>
    setSpec((s) => {
      const enc = { ...(s.encoding ?? {}) };
      if (!field) delete enc[ch];
      else {
        const col = columns.find((c) => c.id === field);
        const isField = col?.kind === "field";
        enc[ch] = {
          field,
          type:
            ch === "x" || ch === "y" || ch === "size"
              ? isField
                ? "quantitative"
                : field === "year"
                  ? "ordinal"
                  : "nominal"
              : field === "year"
                ? "ordinal"
                : "nominal",
        };
      }
      return { ...s, encoding: enc };
    });

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonText);
      setSpec(parsed);
      setJsonErr(null);
    } catch (e) {
      setJsonErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  async function save() {
    setSaveMsg(null);
    const nm = name.trim() || spec.title?.trim() || "Untitled chart";
    const res = chartId
      ? await updateChart(chartId, spec, nm)
      : await createChart(nm, spec);
    if (res.ok) {
      setChartId(res.chart.id);
      setName(res.chart.name);
      setSaveMsg("Saved.");
    } else {
      setSaveMsg(res.error);
    }
  }

  async function exportImage(kind: "svg" | "png") {
    const view = viewRef.current;
    if (!view) return;
    const url = kind === "svg" ? await view.toImageURL("svg") : await view.toImageURL("png", 3);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "chart").replace(/\s+/g, "-")}.${kind}`;
    a.click();
  }

  const canRender = rows.length > 0 && Object.keys(spec.encoding ?? {}).length > 0;
  const inputCls = "h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-2">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Chart name"
          className={`${inputCls} min-w-[220px] flex-1`}
        />
        <button onClick={save} className="h-9 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500">
          {chartId ? "Save" : "Save chart"}
        </button>
        <button onClick={() => exportImage("svg")} disabled={!canRender} className={`${inputCls} disabled:opacity-40`}>
          Export SVG
        </button>
        <button onClick={() => exportImage("png")} disabled={!canRender} className={`${inputCls} disabled:opacity-40`}>
          Export PNG
        </button>
        <button onClick={() => setShowJson((v) => !v)} className={inputCls}>
          {showJson ? "Hide spec" : "</> Spec"}
        </button>
        {saveMsg && <span className="text-sm text-slate-500 dark:text-slate-400">{saveMsg}</span>}
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        {/* LEFT — data */}
        <aside className="flex w-[26%] min-w-[260px] flex-col gap-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Entities</p>
          <select value={entMode} onChange={(e) => setEntMode(e.target.value as typeof entMode)} className={inputCls}>
            <option value="districts">All districts</option>
            <option value="schools">All schools</option>
            <option value="group">Saved group…</option>
          </select>
          {entMode === "group" ? (
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputCls}>
              <option value="">Choose a group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.entityIds.length})
                </option>
              ))}
            </select>
          ) : (
            <select value={county} onChange={(e) => setCounty(e.target.value)} className={inputCls}>
              <option value="">All counties</option>
              {counties.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <p className="text-[11px] text-slate-400">{spec.data.entities.ids.length} entities</p>

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Fields</p>
          {spec.data.fields.map((f) => (
            <div key={f.id} className="rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-800">
              <div className="flex items-start justify-between gap-1">
                <span className="font-medium text-slate-700 dark:text-slate-200">{f.label}</span>
                <button onClick={() => removeField(f.id)} className="text-slate-300 hover:text-red-500">✕</button>
              </div>
              {demoSet.has(f.metric) && (
                <select
                  value={f.subgroup}
                  onChange={(e) => patchField(f.id, { subgroup: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                >
                  {STD_SUBGROUPS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {years.map((y) => (
                  <button
                    key={y}
                    onClick={() =>
                      patchField(f.id, {
                        years: f.years.includes(y)
                          ? f.years.filter((x) => x !== y) .length ? f.years.filter((x) => x !== y) : f.years
                          : [...f.years, y].sort(),
                      })
                    }
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      f.years.includes(y) ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800"
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="mt-2 flex items-center gap-2">
            <select value={year} onChange={(e) => setYear(e.target.value)} className={`${inputCls} flex-1`}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search metrics to add…"
            className={inputCls}
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {metrics.slice(0, 40).map((m) => (
              <button
                key={m.code}
                onClick={() => addField(m)}
                className="block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-left text-sm hover:border-indigo-300 dark:border-slate-800 dark:hover:border-indigo-700"
              >
                <span className="font-medium text-slate-700 dark:text-slate-200">{m.name}</span>
                <span className="block text-xs text-slate-400">{m.category}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* CENTER — canvas */}
        <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {showJson ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              {jsonErr && <p className="text-sm text-red-600">{jsonErr}</p>}
              <button onClick={applyJson} className="self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">
                Apply spec
              </button>
            </div>
          ) : canRender ? (
            <div className="rounded-lg bg-white p-2">
              <VegaChart spec={spec} rows={rows} onView={(v) => (viewRef.current = v)} />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-slate-400">
              {resolving
                ? "Loading data…"
                : "Add entities + a field on the left, then map fields to the chart on the right."}
            </div>
          )}
        </section>

        {/* RIGHT — encoding */}
        <aside className="flex w-[24%] min-w-[220px] flex-col gap-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Chart</p>
          <label className="text-sm text-slate-600 dark:text-slate-300">Mark</label>
          <select
            value={typeof spec.mark === "string" ? spec.mark : "bar"}
            onChange={(e) => setSpec((s) => ({ ...s, mark: e.target.value }))}
            className={inputCls}
          >
            {MARKS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Encoding</p>
          {CHANNELS.map((ch) => (
            <label key={ch} className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{ch}</span>
              <select
                value={spec.encoding?.[ch]?.field ?? ""}
                onChange={(e) => setChannel(ch, e.target.value)}
                className={inputCls}
              >
                <option value="">—</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
          ))}

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Style</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Palette</span>
            <select
              value={spec.theme}
              onChange={(e) => setSpec((s) => ({ ...s, theme: e.target.value as ChartSpec["theme"] }))}
              className={inputCls}
            >
              <option value="app">App colors</option>
              <option value="print">Print (neutral)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Title</span>
            <input
              value={spec.title ?? ""}
              onChange={(e) => setSpec((s) => ({ ...s, title: e.target.value || undefined }))}
              className={inputCls}
            />
          </label>
        </aside>
      </div>
    </div>
  );
}
