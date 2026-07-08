"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { View } from "vega";
import { Icon } from "@/components/icon";
import { IconMenu } from "@/components/icon-menu";
import type { GroupLite } from "@/lib/groups/queries";
import type { SavedViewMeta } from "@/lib/views/queries";
import { searchMetrics } from "@/lib/workshop/actions";
import type { WorkshopEntity } from "@/lib/workshop/queries";
import type { MetricLite } from "@/lib/workshop/types";
import { createChart, updateChart } from "@/lib/charts/actions";
import { getViewForImport } from "@/lib/viz/actions";
import { visualizerChat, type ChatMessage } from "@/lib/viz/chat";
import { columnsOf, resolveDataset, type Row } from "@/lib/viz/resolve";
import { blankSpec, type CalcFieldSpec, type ChartSpec, type EntitySource, type FieldSpec } from "@/lib/viz/spec";
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
const nat = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
let seq = 0;
const newId = (p: string) => `${p}${++seq}_${Math.round(performance.now())}`;

export function Visualizer({
  years,
  entities,
  initialMetrics,
  groups,
  views,
  demographicMetrics,
  initialChart,
}: {
  years: string[];
  entities: WorkshopEntity[];
  initialMetrics: MetricLite[];
  groups: GroupLite[];
  views: SavedViewMeta[];
  demographicMetrics: string[];
  initialChart: { id: number; name: string; spec: ChartSpec } | null;
}) {
  const entitiesById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const demoSet = useMemo(() => new Set(demographicMetrics), [demographicMetrics]);
  const counties = useMemo(
    () => [...new Set(entities.map((e) => e.county).filter(Boolean))].sort() as string[],
    [entities],
  );

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

  // metric browser
  const [year, setYear] = useState(years[0] ?? "");
  const [query, setQuery] = useState("");
  const [metrics, setMetrics] = useState<MetricLite[]>(initialMetrics);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [, startSearch] = useTransition();
  useEffect(() => {
    const t = setTimeout(() => startSearch(async () => setMetrics(await searchMetrics(query, year))), 250);
    return () => clearTimeout(t);
  }, [query, year]);
  const grouped = useMemo(() => {
    if (query.trim()) return null;
    const map = new Map<string, MetricLite[]>();
    for (const m of metrics)
      (map.get(m.category ?? "Other") ?? map.set(m.category ?? "Other", []).get(m.category ?? "Other")!).push(m);
    return [...map.entries()].map(([c, l]) => [c, [...l].sort((a, b) => nat(a.name, b.name))] as const);
  }, [metrics, query]);

  // entity source / panel
  const [entScope, setEntScope] = useState<"district" | "school" | "mixed">("district");
  const [entType, setEntType] = useState<"districts" | "schools" | "both">("districts");
  const [county, setCounty] = useState("");
  const [entOpen, setEntOpen] = useState(false);
  const [entSearch, setEntSearch] = useState("");
  const idSet = useMemo(() => new Set(spec.data.entities.ids), [spec.data.entities.ids]);

  function setEntities(ids: number[], source?: EntitySource["source"], level?: EntitySource["level"]) {
    setSpec((s) => ({
      ...s,
      data: { ...s.data, entities: { ids, level: level ?? s.data.entities.level, source } },
    }));
  }
  function applyBase(base: "districts" | "schools" | "both", c = county) {
    const type = base === "districts" ? "district" : "school";
    setEntType(base);
    setEntScope(base === "both" ? "mixed" : type);
    setEntities(
      entities
        .filter((e) => (base === "both" || e.type === type) && (!c || e.county === c))
        .map((e) => e.id),
      undefined,
      base === "both" ? "both" : type,
    );
  }
  function applyGroup(gid: string) {
    const g = groups.find((x) => String(x.id) === gid);
    if (!g) return;
    setEntType("both");
    setEntScope("mixed");
    setEntities(g.entityIds, { kind: "group", id: g.id, name: g.name }, "both");
  }
  function toggleEntity(id: number) {
    const next = new Set(idSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEntities([...next], spec.data.entities.source, spec.data.entities.level);
  }
  const universe = useMemo(() => {
    const base =
      entScope === "district"
        ? entities.filter((e) => e.type === "district")
        : entScope === "school"
          ? entities.filter((e) => e.type === "school")
          : entities;
    const q = entSearch.trim().toLowerCase();
    return base.filter((e) => !q || e.name.toLowerCase().includes(q));
  }, [entities, entScope, entSearch]);

  async function importView(v: SavedViewMeta) {
    const st = await getViewForImport(v.id);
    if (!st) return;
    const hidden = new Set(st.hidden);
    const ids = entities
      .filter((e) => {
        if (st.viewMode === "districts" && e.type !== "district") return false;
        if (st.viewMode === "schools" && e.type !== "school") return false;
        if (st.county && e.county !== st.county) return false;
        return !hidden.has(e.id);
      })
      .map((e) => e.id);
    const calc: CalcFieldSpec[] = st.columns
      .filter((c) => c.kind === "calc")
      .map((c) => ({
        id: c.id,
        name: c.name,
        calcType: c.calcType,
        sourceIds: c.sourceIds,
        weights: c.weights,
        asPercent: c.asPercent,
        refEntityId: c.refEntityId ?? null,
      }));
    const calcRefs = new Set(calc.flatMap((c) => c.sourceIds));

    // Collapse same-metric/subgroup columns (across years) into one multi-year
    // field so they can be a line over time. Columns a calc field references
    // stay separate so the calc keeps working.
    const fields: FieldSpec[] = [];
    const merged = new Map<string, FieldSpec>();
    const fieldFrom = (c: (typeof st.columns)[number] & { kind: "data" }, years: string[]): FieldSpec => ({
      id: c.id,
      metric: c.metric.code,
      metricName: c.metric.name,
      years,
      subgroup: c.subgroup ?? "All Students",
      label: c.metric.name,
      dataType: c.metric.dataType,
      unit: c.metric.unit,
    });
    for (const c of st.columns) {
      if (c.kind !== "data") continue;
      if (calcRefs.has(c.id)) {
        fields.push(fieldFrom(c, [c.year]));
        continue;
      }
      const key = `${c.metric.code}::${c.subgroup ?? "All Students"}`;
      const cur = merged.get(key);
      if (cur) cur.years = [...new Set([...cur.years, c.year])].sort();
      else merged.set(key, fieldFrom(c, [c.year]));
    }
    fields.push(...merged.values());

    setEntType(st.viewMode === "schools" ? "schools" : st.viewMode === "districts" ? "districts" : "both");
    setEntScope(st.viewMode === "schools" ? "school" : st.viewMode === "districts" ? "district" : "mixed");
    // Default encoding so a chart draws on import (old encoding referenced the
    // previous fields). Multi-year → a line over years, one line per entity.
    const firstField = fields[0]?.id ?? calc[0]?.id;
    const multiYear = fields.some((f) => f.years.length > 1);
    const encoding: ChartSpec["encoding"] = !firstField
      ? {}
      : multiYear
        ? {
            x: { field: "year", type: "ordinal" },
            y: { field: firstField, type: "quantitative" },
            color: { field: "entityName", type: "nominal" },
          }
        : { x: { field: "entityName", type: "nominal", sort: "-y" }, y: { field: firstField, type: "quantitative" } };
    setSpec((s) => ({
      ...s,
      mark: multiYear ? "line" : "bar",
      encoding,
      data: {
        entities: { ids, level: st.viewMode === "schools" ? "school" : st.viewMode === "both" ? "both" : "district", source: { kind: "view", id: v.id, name: v.name } },
        fields,
        calc,
      },
    }));
  }

  // ── AI assistant ──
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiMsgs, setAiMsgs] = useState<(ChatMessage & { error?: boolean })[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const aiScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    aiScroll.current?.scrollTo({ top: aiScroll.current.scrollHeight });
  }, [aiMsgs, aiBusy]);

  // Full metric catalog (for the AI prompt + resolving codes the AI returns).
  const metricByCode = useMemo(
    () => new Map(initialMetrics.map((m) => [m.code, m])),
    [initialMetrics],
  );

  // Apply a chart command from the AI onto the current spec.
  function applyAiChart(chart: unknown) {
    if (!chart || typeof chart !== "object") return;
    const c = chart as Record<string, unknown>;

    // entities
    const ent = c.entities;
    if (ent && ent !== "keep") {
      if (ent === "districts" || ent === "schools" || ent === "both") applyBase(ent);
      else if (typeof ent === "object" && "group" in ent) {
        const name = String((ent as { group: unknown }).group).toLowerCase();
        const g = groups.find((x) => x.name.toLowerCase() === name);
        if (g) applyGroup(String(g.id));
      }
    }

    // fields — keep only ones whose metric code we recognise
    const rawFields = Array.isArray(c.fields) ? (c.fields as Record<string, unknown>[]) : null;
    if (rawFields) {
      const fields: FieldSpec[] = rawFields
        .map((f) => {
          const code = String(f.metric ?? "");
          const m = metricByCode.get(code);
          if (!m) return null;
          const yrs = Array.isArray(f.years) && f.years.length ? (f.years as string[]) : [year];
          return {
            id: String(f.id ?? newId("f")),
            metric: code,
            metricName: m.name,
            years: yrs.filter((y) => years.includes(y)),
            subgroup: typeof f.subgroup === "string" ? f.subgroup : "All Students",
            label: typeof f.label === "string" && f.label ? f.label : m.name,
            dataType: m.dataType,
            unit: m.unit,
          } as FieldSpec;
        })
        .filter((f): f is FieldSpec => f !== null && f.years.length > 0);
      setSpec((s) => ({
        ...s,
        mark: typeof c.mark === "string" ? c.mark : s.mark,
        encoding: (c.encoding as ChartSpec["encoding"]) ?? s.encoding,
        title: typeof c.title === "string" ? c.title : s.title,
        data: { ...s.data, fields, calc: [] },
      }));
    } else if (c.encoding || c.mark || typeof c.title === "string") {
      setSpec((s) => ({
        ...s,
        mark: typeof c.mark === "string" ? c.mark : s.mark,
        encoding: (c.encoding as ChartSpec["encoding"]) ?? s.encoding,
        title: typeof c.title === "string" ? c.title : s.title,
      }));
    }
  }

  async function sendAi() {
    const text = aiInput.trim();
    if (!text || aiBusy) return;
    const history: ChatMessage[] = [...aiMsgs.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: text }];
    setAiMsgs((m) => [...m, { role: "user", content: text }]);
    setAiInput("");
    setAiBusy(true);
    const res = await visualizerChat(history, spec, {
      metrics: initialMetrics.map((m) => ({ code: m.code, name: m.name, category: m.category ?? null })),
      years,
      subgroups: STD_SUBGROUPS,
      groups: groups.map((g) => g.name),
    });
    setAiBusy(false);
    if (res.ok) {
      setAiMsgs((m) => [...m, { role: "assistant", content: res.reply || "(done)" }]);
      if (res.chart) applyAiChart(res.chart);
    } else {
      setAiMsgs((m) => [...m, { role: "assistant", content: res.error, error: true }]);
    }
  }

  // A fresh chart starts on "Districts only" — populate that set once on mount.
  useEffect(() => {
    if (!initialChart) applyBase("districts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // resolve on data change
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

  useEffect(() => {
    if (!showJson) setJsonText(JSON.stringify(spec, null, 2));
  }, [spec, showJson]);

  const columns = useMemo(() => columnsOf(spec.data.fields, spec.data.calc), [spec.data.fields, spec.data.calc]);

  function addField(m: MetricLite) {
    const f: FieldSpec = {
      id: newId("f"),
      metric: m.code,
      metricName: m.name,
      years: [year],
      subgroup: "All Students",
      label: m.name,
      dataType: m.dataType,
      unit: m.unit,
    };
    setSpec((s) => {
      const enc =
        Object.keys(s.encoding ?? {}).length === 0
          ? { x: { field: "entityName", type: "nominal" as const, sort: "-y" }, y: { field: f.id, type: "quantitative" as const } }
          : s.encoding;
      return { ...s, data: { ...s.data, fields: [...s.data.fields, f] }, encoding: enc };
    });
  }
  const removeField = (id: string) =>
    setSpec((s) => ({
      ...s,
      data: {
        ...s.data,
        fields: s.data.fields.filter((f) => f.id !== id),
        calc: s.data.calc.filter((c) => c.id !== id),
      },
    }));
  const patchField = (id: string, patch: Partial<FieldSpec>) =>
    setSpec((s) => ({
      ...s,
      data: { ...s.data, fields: s.data.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) },
    }));

  const setChannel = (ch: string, field: string) =>
    setSpec((s) => {
      const enc = { ...(s.encoding ?? {}) };
      if (!field) delete enc[ch];
      else {
        const isField = columns.find((c) => c.id === field)?.kind === "field";
        enc[ch] = {
          field,
          type:
            ch === "x" || ch === "y" || ch === "size"
              ? isField ? "quantitative" : field === "year" ? "ordinal" : "nominal"
              : field === "year" ? "ordinal" : "nominal",
        };
      }
      return { ...s, encoding: enc };
    });

  function applyJson() {
    try {
      setSpec(JSON.parse(jsonText));
      setJsonErr(null);
    } catch (e) {
      setJsonErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  }
  async function save() {
    setSaveMsg(null);
    const nm = name.trim() || spec.title?.trim() || "Untitled chart";
    const res = chartId ? await updateChart(chartId, spec, nm) : await createChart(nm, spec);
    if (res.ok) {
      setChartId(res.chart.id);
      setName(res.chart.name);
      setSaveMsg("Saved.");
    } else setSaveMsg(res.error);
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
  const provenance = spec.data.entities.source;
  const input = "h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
  const iconBtn =
    "flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800";
  const iconBtnActive =
    "flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500 bg-indigo-600 text-white";

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col gap-2">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chart name" className={`${input} min-w-[220px] flex-1`} />
        <button onClick={save} className={iconBtn} title="Save chart">
          <Icon name="saveViewOrGroup" />
        </button>
        <IconMenu
          icon="export"
          title="Export chart (SVG / PNG)"
          buttonClassName={iconBtn}
          disabled={!canRender}
          items={[
            { label: "SVG", onClick: () => exportImage("svg") },
            { label: "PNG", onClick: () => exportImage("png") },
          ]}
        />
        {saveMsg && <span className="text-sm text-slate-500 dark:text-slate-400">{saveMsg}</span>}
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        {/* LEFT — data */}
        <aside className="flex w-[27%] min-w-[280px] flex-col gap-3 overflow-y-auto [scrollbar-gutter:stable] rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Entities ({spec.data.entities.ids.length})
          </p>
          <select value={entType} onChange={(e) => applyBase(e.target.value as "districts" | "schools" | "both")} className={input}>
            <option value="districts">Districts only</option>
            <option value="schools">Schools only</option>
            <option value="both">Districts &amp; schools</option>
          </select>
          <select value={county} onChange={(e) => { setCounty(e.target.value); applyBase(entType, e.target.value); }} className={input}>
            <option value="">All counties</option>
            {counties.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Saved Group</span>
            <select value="" onChange={(e) => e.target.value && applyGroup(e.target.value)} className={`${input} flex-1`}>
              <option value="">{groups.length ? "Choose a group…" : "No saved groups"}</option>
              {groups.map((g) => (<option key={g.id} value={g.id}>{g.name} ({g.entityIds.length})</option>))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Saved View</span>
            <select
              value=""
              onChange={(e) => {
                const v = views.find((x) => String(x.id) === e.target.value);
                if (v) void importView(v);
              }}
              className={`${input} flex-1`}
            >
              <option value="">{views.length ? "Import a view…" : "No saved views"}</option>
              {views.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
            </select>
          </label>
          {provenance && <p className="text-[11px] text-indigo-500">from {provenance.kind}: {provenance.name}</p>}

          <button onClick={() => setEntOpen((v) => !v)} className={`${input} flex items-center justify-center gap-2`}>
            <Icon name="myDistrictSchools" className="h-4 w-4" />
            {entOpen ? "Hide entity list" : "Choose entities…"}
          </button>
          {entOpen && (
            <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              <input type="search" value={entSearch} onChange={(e) => setEntSearch(e.target.value)} placeholder="Search…" className={`${input} w-full`} />
              <div className="mt-1 flex gap-2 text-xs">
                <button onClick={() => setEntities([...new Set([...idSet, ...universe.map((e) => e.id)])], provenance, spec.data.entities.level)} className="text-indigo-600 hover:underline">Add shown</button>
                <button onClick={() => { const rm = new Set(universe.map((e) => e.id)); setEntities([...idSet].filter((id) => !rm.has(id)), provenance, spec.data.entities.level); }} className="text-indigo-600 hover:underline">Remove shown</button>
              </div>
              <div className="mt-1 max-h-52 overflow-y-auto">
                {universe.slice(0, 400).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 px-1 py-0.5 text-sm">
                    <input type="checkbox" checked={idSet.has(e.id)} onChange={() => toggleEntity(e.id)} />
                    <span className="truncate text-slate-700 dark:text-slate-200">{e.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Fields */}
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Fields</p>
          {spec.data.calc.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
              <span className="text-indigo-700 dark:text-indigo-300">ƒ {c.name}</span>
              <button onClick={() => removeField(c.id)} className="text-slate-300 hover:text-red-500">✕</button>
            </div>
          ))}
          {spec.data.fields.map((f) => (
            <div key={f.id} className="rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-800">
              <div className="flex items-start justify-between gap-1">
                <span className="font-medium text-slate-700 dark:text-slate-200">{f.label}</span>
                <button onClick={() => removeField(f.id)} className="text-slate-300 hover:text-red-500">✕</button>
              </div>
              {demoSet.has(f.metric) && (
                <select value={f.subgroup} onChange={(e) => patchField(f.id, { subgroup: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-950">
                  {STD_SUBGROUPS.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {years.map((y) => (
                  <button
                    key={y}
                    onClick={() =>
                      patchField(f.id, {
                        years: f.years.includes(y)
                          ? f.years.filter((x) => x !== y).length ? f.years.filter((x) => x !== y) : f.years
                          : [...f.years, y].sort(),
                      })
                    }
                    className={`rounded px-1.5 py-0.5 text-[11px] ${f.years.includes(y) ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Metric browser */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Add metric</span>
            <select value={year} onChange={(e) => setYear(e.target.value)} className={`${input} ml-auto`}>
              {years.map((y) => (<option key={y} value={y}>{y}</option>))}
            </select>
          </div>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search metrics…" className={input} />
          {grouped && (
            <div className="flex gap-3 text-xs text-slate-400">
              <button onClick={() => setOpenCats(new Set(grouped.map(([c]) => c)))} className="hover:text-slate-700">Expand all</button>
              <button onClick={() => setOpenCats(new Set())} className="hover:text-slate-700">Collapse all</button>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-1">
            {grouped
              ? grouped.map(([cat, list]) => {
                  const open = openCats.has(cat);
                  return (
                    <div key={cat}>
                      <button
                        onClick={() => setOpenCats((p) => { const n = new Set(p); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })}
                        className="flex w-full items-center gap-1.5 py-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 dark:text-slate-400"
                      >
                        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
                        <span className="flex-1">{cat}</span>
                        <span className="font-normal text-slate-400">{list.length}</span>
                      </button>
                      {open && (
                        <div className="space-y-1 py-1">
                          {list.map((m) => (
                            <button key={m.code} onClick={() => addField(m)} className="block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-left text-sm hover:border-indigo-300 dark:border-slate-800 dark:hover:border-indigo-700">
                              <span className="font-medium text-slate-700 dark:text-slate-200">{m.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              : metrics.map((m) => (
                  <button key={m.code} onClick={() => addField(m)} className="block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-left text-sm hover:border-indigo-300 dark:border-slate-800 dark:hover:border-indigo-700">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{m.name}</span>
                    <span className="block text-xs text-slate-400">{m.category}</span>
                  </button>
                ))}
          </div>
        </aside>

        {/* CENTER — canvas */}
        <section className="relative flex min-w-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {/* spec toggle, top-right of the graph (replaces vega's export menu) */}
          <button
            onClick={() => setShowJson((v) => !v)}
            className={`absolute right-2 top-2 z-10 ${showJson ? iconBtnActive : iconBtn}`}
            title={showJson ? "Back to chart" : "Edit spec (JSON)"}
          >
            <Icon name="spec" />
          </button>
          {showJson ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} className="min-h-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
              {jsonErr && <p className="text-sm text-red-600">{jsonErr}</p>}
              <button onClick={applyJson} className="self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500">Apply spec</button>
            </div>
          ) : canRender ? (
            <div className="rounded-lg bg-white p-2">
              <VegaChart spec={spec} rows={rows} onView={(v) => (viewRef.current = v)} />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-slate-400">
              {resolving ? "Loading data…" : "Pick entities + add a field on the left, then map fields on the right."}
            </div>
          )}
        </section>

        {/* RIGHT — encoding */}
        <aside className="flex w-[22%] min-w-[220px] flex-col gap-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Chart</p>
          <label className="text-sm text-slate-600 dark:text-slate-300">Mark</label>
          <select value={typeof spec.mark === "string" ? spec.mark : "bar"} onChange={(e) => setSpec((s) => ({ ...s, mark: e.target.value }))} className={input}>
            {MARKS.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Encoding</p>
          {CHANNELS.map((ch) => (
            <label key={ch} className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">{ch}</span>
              <select value={spec.encoding?.[ch]?.field ?? ""} onChange={(e) => setChannel(ch, e.target.value)} className={input}>
                <option value="">—</option>
                {columns.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
            </label>
          ))}
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Style</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Palette</span>
            <select value={spec.theme} onChange={(e) => setSpec((s) => ({ ...s, theme: e.target.value as ChartSpec["theme"] }))} className={input}>
              <option value="app">App colors</option>
              <option value="print">Print (neutral)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Title</span>
            <input value={spec.title ?? ""} onChange={(e) => setSpec((s) => ({ ...s, title: e.target.value || undefined }))} className={input} />
          </label>
        </aside>
      </div>

      {/* BOTTOM — AI assistant */}
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <button
          onClick={() => setAiOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">AI</span>
          <span className="flex-1">Ask the AI to build or explain this chart</span>
          <span className="text-slate-400">{aiOpen ? "▾" : "▸"}</span>
        </button>
        {aiOpen && (
          <div className="flex h-56 flex-col border-t border-slate-200 dark:border-slate-800">
            <div ref={aiScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {aiMsgs.length === 0 && (
                <p className="text-sm text-slate-400">
                  Try “compare 4-year graduation rates for these districts” or “which of these
                  metrics would show equity gaps best?” — I’ll build the chart and answer questions.
                </p>
              )}
              {aiMsgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white"
                        : m.error
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {aiBusy && <p className="text-sm text-slate-400">Thinking…</p>}
            </div>
            <div className="flex gap-2 border-t border-slate-200 p-2 dark:border-slate-800">
              <input
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendAi(); } }}
                placeholder="Tell the AI what to chart, or ask about the data…"
                className={`${input} flex-1`}
              />
              <button
                onClick={() => void sendAi()}
                disabled={aiBusy || !aiInput.trim()}
                className="rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
