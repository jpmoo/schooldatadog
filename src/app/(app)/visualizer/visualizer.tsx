"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { View } from "vega";
import { Icon } from "@/components/icon";
import { IconMenu } from "@/components/icon-menu";
import { createGroup, overwriteGroup } from "@/lib/groups/actions";
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

// Friendly, plain-language chart controls (Vega-Lite marks/channels underneath).
const MARK_OPTIONS = [
  { value: "bar", label: "Bars" },
  { value: "histogram", label: "Histogram" },
  { value: "line", label: "Line" },
  { value: "point", label: "Dots (scatter)" },
  { value: "area", label: "Area" },
  { value: "tick", label: "Ticks" },
  { value: "rect", label: "Heatmap" },
] as const;
const BUBBLE_OPTIONS = [
  { v: "circle-filled", label: "Filled circle" },
  { v: "circle-outline", label: "Outline circle" },
  { v: "square-filled", label: "Filled square" },
  { v: "square-outline", label: "Outline square" },
  { v: "diamond-filled", label: "Filled diamond" },
  { v: "diamond-outline", label: "Outline diamond" },
  { v: "none", label: "None" },
] as const;
const PRIMARY_CHANNELS = [
  { ch: "x", label: "Bottom axis", hint: "What runs left-to-right." },
  { ch: "y", label: "Left axis", hint: "What runs bottom-to-top (usually the number)." },
  { ch: "color", label: "Color by", hint: "A separate color for each value." },
] as const;
const ADVANCED_CHANNELS = [
  { ch: "xOffset", label: "Side-by-side bars", hint: "Groups each bar into a cluster. Set to Year to show years side by side per district." },
  { ch: "column", label: "Small charts across", hint: "One mini-chart per value, left → right." },
  { ch: "row", label: "Small charts down", hint: "One mini-chart per value, top → bottom." },
  { ch: "size", label: "Bubble size", hint: "Bigger mark = bigger value. Best with Dots." },
] as const;
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
  groups: initialGroups,
  views,
  demographicMetrics,
  initialChart,
  homeDistrictId,
  importViewId = null,
}: {
  years: string[];
  entities: WorkshopEntity[];
  initialMetrics: MetricLite[];
  groups: GroupLite[];
  views: SavedViewMeta[];
  demographicMetrics: string[];
  initialChart: { id: number; name: string; spec: ChartSpec } | null;
  homeDistrictId: number | null;
  importViewId?: number | null;
}) {
  const entitiesById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const demoSet = useMemo(() => new Set(demographicMetrics), [demographicMetrics]);
  const counties = useMemo(
    () => [...new Set(entities.map((e) => e.county).filter(Boolean))].sort() as string[],
    [entities],
  );
  const homeDistrictName = homeDistrictId != null ? (entitiesById.get(homeDistrictId)?.name ?? null) : null;

  // Split any saved AI chat out of the spec — it restores into the chat panel,
  // not the live chart spec (keeps the JSON/render clean).
  const [spec, setSpec] = useState<ChartSpec>(() => {
    const s = initialChart?.spec ?? blankSpec();
    const withoutChat = { ...s };
    delete withoutChat.chat;
    return withoutChat;
  });
  const [chartId, setChartId] = useState<number | null>(initialChart?.id ?? null);
  const [name, setName] = useState(initialChart?.name ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [resolving, setResolving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [advOpen, setAdvOpen] = useState(false);
  const [groups, setGroups] = useState<GroupLite[]>(initialGroups);
  // Save-as-group dialog state.
  const [groupSave, setGroupSave] = useState<{ name: string; err: string | null } | null>(null);
  const [groupConflict, setGroupConflict] = useState<{ name: string; id: number } | null>(null);
  const viewRef = useRef<View | null>(null);
  const onChartView = useCallback((v: View | null) => {
    viewRef.current = v;
  }, []);

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
  function addGroupToList(g: GroupLite) {
    setGroups((gs) => [...gs.filter((x) => x.id !== g.id), g].sort((a, b) => a.name.localeCompare(b.name)));
  }
  async function saveGroup(name: string): Promise<void> {
    const ids = spec.data.entities.ids;
    const res = await createGroup(name, ids);
    if (res.ok) {
      addGroupToList(res.group);
      setGroupSave(null);
    } else if ("conflict" in res) {
      setGroupConflict({ name, id: res.conflict.id });
      setGroupSave(null);
    } else {
      setGroupSave((g) => (g ? { ...g, err: res.error } : g));
    }
  }
  async function resolveGroupConflict(mode: "overwrite" | "new") {
    if (!groupConflict) return;
    const { name, id } = groupConflict;
    const ids = spec.data.entities.ids;
    const res = mode === "overwrite" ? await overwriteGroup(id, ids) : await createGroup(name, ids, true);
    if (res.ok) addGroupToList(res.group);
    setGroupConflict(null);
  }
  const universe = useMemo(() => {
    const base =
      entScope === "district"
        ? entities.filter((e) => e.type === "district")
        : entScope === "school"
          ? entities.filter((e) => e.type === "school")
          : entities;
    const q = entSearch.trim().toLowerCase();
    // Selected entities float to the top, each group alphabetical.
    return base
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const pa = idSet.has(a.id) ? 0 : 1;
        const pb = idSet.has(b.id) ? 0 : 1;
        return pa - pb || a.name.localeCompare(b.name, undefined, { numeric: true });
      });
  }, [entities, entScope, entSearch, idSet]);

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
        direction: c.direction,
        refMode: c.refMode,
        refValue: c.refValue ?? null,
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
    // Prefer a directly-plottable field; fall back to a calc field (e.g. a growth
    // rate) when every field is only there to feed a calc.
    const firstField =
      fields.find((f) => !calcRefs.has(f.id))?.id ?? calc[0]?.id ?? fields[0]?.id;
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
  const initialChat = (initialChart?.spec.chat ?? []) as (ChatMessage & { error?: boolean })[];
  const [aiOpen, setAiOpen] = useState(initialChat.length > 0);
  const [aiInput, setAiInput] = useState("");
  const [aiMsgs, setAiMsgs] = useState<(ChatMessage & { error?: boolean })[]>(initialChat);
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
  function applyAiChart(chart: unknown, userText = "") {
    if (!chart || typeof chart !== "object") return;
    const c = chart as Record<string, unknown>;

    // entities — protect a curated selection (e.g. an imported view). A bare
    // "all districts/schools" only takes effect if it's empty or the user
    // clearly asked to broaden the set; group/view references always apply.
    const ent = c.entities;
    if (ent && ent !== "keep") {
      const wantsAll =
        /\ball\b|\bevery\b|\bstatewide\b|\bacross all\b|\bwhole state\b|\bentire state\b/i.test(userText);
      const hasSelection = spec.data.entities.ids.length > 0;
      if (ent === "districts" || ent === "schools" || ent === "both") {
        if (!hasSelection || wantsAll) applyBase(ent);
      } else if (typeof ent === "object" && "group" in ent) {
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
      setSpec((s) => ({ ...s, ...aiOverrides(c, s), data: { ...s.data, fields, calc: [] } }));
    } else if (c.encoding || c.mark || typeof c.title === "string" || c.theme || "showLegend" in c) {
      setSpec((s) => ({ ...s, ...aiOverrides(c, s) }));
    }
  }

  // Every chart-level setting the AI can drive, so the whole page reflects it.
  function aiOverrides(c: Record<string, unknown>, s: ChartSpec): Partial<ChartSpec> {
    return {
      mark: typeof c.mark === "string" ? c.mark : s.mark,
      encoding: (c.encoding as ChartSpec["encoding"]) ?? s.encoding,
      title: typeof c.title === "string" ? c.title : s.title,
      theme: c.theme === "app" || c.theme === "print" ? c.theme : s.theme,
      showLegend: typeof c.showLegend === "boolean" ? c.showLegend : s.showLegend,
    };
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
      homeDistrict: homeDistrictName,
      selectedEntities: spec.data.entities.ids
        .map((id) => entitiesById.get(id)?.name)
        .filter((n): n is string => !!n),
    });
    setAiBusy(false);
    if (res.ok) {
      const reply = (res.reply ?? "").trim();
      // Never surface raw JSON in the chat — if the model is building a chart and
      // didn't give a clean prose note, show a friendly status instead.
      const looksJson = /^[[{]/.test(reply) || reply.includes('"encoding"') || reply.includes('"fields"');
      const content = res.chart
        ? !reply || looksJson
          ? "Building visualization…"
          : reply
        : reply || "(done)";
      setAiMsgs((m) => [...m, { role: "assistant", content }]);
      if (res.chart) applyAiChart(res.chart, text);
    } else {
      setAiMsgs((m) => [...m, { role: "assistant", content: res.error, error: true }]);
    }
  }

  // A fresh chart starts on "Districts only" — populate that set once on mount.
  // If arriving via ?view=<id> (e.g. from the workshop), import that view instead.
  useEffect(() => {
    if (initialChart) return;
    const v = importViewId != null ? views.find((x) => x.id === importViewId) : null;
    if (v) void importView(v);
    else applyBase("districts");
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
    resolveDataset(spec.data, entitiesById, homeDistrictId)
      .then((res) => {
        if (live) {
          setRows(res.rows);
          setResolving(false);
        }
      })
      .catch(() => {
        if (live) setResolving(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  useEffect(() => {
    if (!showJson) setJsonText(JSON.stringify(spec, null, 2));
  }, [spec, showJson]);

  const columns = useMemo(
    () => columnsOf(spec.data.fields, spec.data.calc, homeDistrictId != null),
    [spec.data.fields, spec.data.calc, homeDistrictId],
  );
  const axisLabels = useMemo(() => Object.fromEntries(columns.map((c) => [c.id, c.label])), [columns]);

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
      if (field === "__count__") {
        // A positional axis with no data field counts the records. Make it an
        // explicit aggregate so it carries an editable title (default "Count").
        const prev = enc[ch] as Record<string, unknown> | undefined;
        enc[ch] = {
          aggregate: "count",
          type: "quantitative",
          ...(typeof prev?.title === "string" ? { title: prev.title } : {}),
        };
      } else if (!field) delete enc[ch];
      else {
        const isField = columns.find((c) => c.id === field)?.kind === "field";
        // Preserve binning when swapping the field on a histogram's axis.
        const prev = enc[ch] as Record<string, unknown> | undefined;
        const keepBin = prev && "bin" in prev ? { bin: prev.bin } : {};
        enc[ch] = {
          field,
          type:
            ch === "x" || ch === "y" || ch === "size"
              ? isField ? "quantitative" : field === "year" ? "ordinal" : "nominal"
              : field === "year" ? "ordinal" : "nominal",
          ...keepBin,
        };
      }
      return { ...s, encoding: enc };
    });

  // Override a channel's axis/legend label; empty reverts to the friendly default.
  const setChannelTitle = (ch: string, title: string) =>
    setSpec((s) => {
      const cur = s.encoding?.[ch];
      const enc = { ...(s.encoding ?? {}) };
      if (!cur) {
        // An empty positional axis is an implicit count; titling it makes the
        // count explicit so the label sticks. Nothing to title elsewhere.
        if ((ch !== "x" && ch !== "y") || !title) return s;
        enc[ch] = { aggregate: "count", type: "quantitative", title };
        return { ...s, encoding: enc };
      }
      const next = { ...cur };
      if (title) next.title = title;
      else delete next.title;
      enc[ch] = next;
      return { ...s, encoding: enc };
    });

  // Sort order for a categorical channel (axis / grouping / colour).
  const channelSortValue = (ch: string) => {
    const srt = (spec.encoding?.[ch] as Record<string, unknown> | undefined)?.sort;
    return typeof srt === "string" ? srt : "";
  };
  const setChannelSort = (ch: string, value: string) =>
    setSpec((s) => {
      const cur = s.encoding?.[ch] as Record<string, unknown> | undefined;
      if (!cur) return s;
      const enc = { ...(s.encoding ?? {}) } as Record<string, Record<string, unknown>>;
      const next = { ...cur };
      if (value) next.sort = value;
      else delete next.sort;
      enc[ch] = next;
      return { ...s, encoding: enc as ChartSpec["encoding"] };
    });
  // A channel holds a sortable category when it has a field that isn't a
  // continuous measure (quantitative / binned / aggregated). Sorting is only
  // offered on the axes (x/y), not on colour / size / grouping channels.
  const isCategoricalChannel = (ch: string) => {
    if (ch !== "x" && ch !== "y") return false;
    const c = spec.encoding?.[ch] as Record<string, unknown> | undefined;
    return !!c?.field && c.type !== "quantitative" && !("bin" in c) && !("aggregate" in c);
  };
  const sortOptionsFor = (ch: string) => {
    const opts = [
      { v: "", label: "Sort: default" },
      { v: "ascending", label: "Sort: A → Z / low → high" },
      { v: "descending", label: "Sort: Z → A / high → low" },
    ];
    if (ch === "x") opts.push({ v: "-y", label: "Sort: by value, high → low" }, { v: "y", label: "Sort: by value, low → high" });
    else if (ch === "y") opts.push({ v: "-x", label: "Sort: by value, high → low" }, { v: "x", label: "Sort: by value, low → high" });
    return opts;
  };
  const SortSelect = ({ ch }: { ch: string }) =>
    isCategoricalChannel(ch) ? (
      <select
        value={channelSortValue(ch)}
        onChange={(e) => setChannelSort(ch, e.target.value)}
        className={`${input} w-full text-xs`}
        title="Order of the values on this channel"
      >
        {sortOptionsFor(ch).map((o) => (
          <option key={o.v} value={o.v}>{o.label}</option>
        ))}
      </select>
    ) : null;

  // Axis scale/tick controls, stored as our own numeric keys on the channel
  // (axisMin/axisMax/majorStep/minorStep) and translated to a Vega-Lite scale +
  // explicit tick values by VegaChart. "interval" must be positive; empty clears.
  const setAxisNum = (ch: string, key: "axisMin" | "axisMax" | "interval", raw: string) =>
    setSpec((s) => {
      const cur = s.encoding?.[ch] as Record<string, unknown> | undefined;
      if (!cur) return s;
      const enc = { ...(s.encoding ?? {}) } as Record<string, Record<string, unknown>>;
      const next: Record<string, unknown> = { ...cur };
      const n = Number(raw);
      const ok = raw.trim() !== "" && !Number.isNaN(n) && (key !== "interval" || n > 0);
      if (ok) next[key] = n;
      else delete next[key];
      enc[ch] = next;
      return { ...s, encoding: enc as ChartSpec["encoding"] };
    });
  const axisNumOf = (ch: string, key: "axisMin" | "axisMax" | "interval") => {
    const v = (spec.encoding?.[ch] as Record<string, unknown> | undefined)?.[key];
    return typeof v === "number" ? v : "";
  };
  // Min/Max/Interval only make sense on a continuous (quantitative, non-binned) axis.
  const isNumericAxis = (ch: string) => {
    const c = spec.encoding?.[ch] as Record<string, unknown> | undefined;
    return !!c && c.type === "quantitative" && !("bin" in c);
  };
  // The default (data-derived) bounds an axis uses when Min/Max aren't set, so
  // they can be shown in the boxes. Matches VegaChart's extent logic.
  const axisExtent = (ch: string): { lo: number | ""; hi: number | "" } => {
    const c = spec.encoding?.[ch] as Record<string, unknown> | undefined;
    const field = c?.field;
    if (typeof field !== "string" || "aggregate" in (c ?? {})) return { lo: "", hi: "" };
    const nums = rows.map((r) => r[field]).filter((v): v is number => typeof v === "number");
    if (!nums.length) return { lo: "", hi: "" };
    const mk = typeof spec.mark === "string" ? spec.mark : "bar";
    const lo = mk === "bar" || mk === "area" ? Math.min(...nums, 0) : Math.min(...nums);
    return { lo, hi: Math.max(...nums) };
  };

  // Histogram bucketing on the x axis: a fixed range size (bin.step) OR a target
  // number of buckets (bin.maxbins) — never both. Empty/invalid → auto (bin:true).
  const binOf = () => {
    const b = (spec.encoding?.x as Record<string, unknown> | undefined)?.bin;
    const o = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
    return {
      step: typeof o.step === "number" ? o.step : "",
      maxbins: typeof o.maxbins === "number" ? o.maxbins : "",
    };
  };
  const setBin = (key: "step" | "maxbins", raw: string) =>
    setSpec((s) => {
      const cur = s.encoding?.x as Record<string, unknown> | undefined;
      if (!cur) return s;
      const enc = { ...(s.encoding ?? {}) } as Record<string, Record<string, unknown>>;
      const n = Number(raw);
      const ok = raw.trim() !== "" && !Number.isNaN(n) && n > 0;
      enc.x = { ...cur, bin: ok ? { [key]: n } : true };
      return { ...s, encoding: enc as ChartSpec["encoding"] };
    });

  // "Chart type" is the mark, plus a "histogram" preset (binned x + count y).
  const chartType = (() => {
    const x = spec.encoding?.x as Record<string, unknown> | undefined;
    const y = spec.encoding?.y as Record<string, unknown> | undefined;
    if (spec.mark === "bar" && x?.bin && y?.aggregate === "count") return "histogram";
    return typeof spec.mark === "string" ? spec.mark : "bar";
  })();
  function setChartType(value: string) {
    setSpec((s) => {
      const enc = { ...(s.encoding ?? {}) } as Record<string, Record<string, unknown>>;
      if (value === "histogram") {
        // Bin a numeric VALUE field (a metric / calc field) on x — never a
        // built-in like entityName. Prefer the current y field, then x, then
        // the first data field.
        const dataIds = new Set([...s.data.fields.map((f) => f.id), ...s.data.calc.map((c) => c.id)]);
        const yf = enc.y?.field as string | undefined;
        const xf = enc.x?.field as string | undefined;
        const binField =
          (yf && dataIds.has(yf) && yf) ||
          (xf && dataIds.has(xf) && xf) ||
          s.data.fields[0]?.id ||
          s.data.calc[0]?.id;
        if (!binField) return { ...s, mark: "bar" }; // nothing numeric to bin
        enc.x = { field: binField, type: "quantitative", bin: true };
        enc.y = { aggregate: "count", type: "quantitative" };
        return { ...s, mark: "bar", encoding: enc as ChartSpec["encoding"] };
      }
      // Leaving histogram: undo the binned-x / count-y scaffolding.
      const wasHist = enc.x?.bin && enc.y?.aggregate === "count";
      if (wasHist) {
        if (enc.x) {
          const x = { ...enc.x };
          delete x.bin;
          enc.x = x;
        }
        delete enc.y;
      }
      // Outline highlight doesn't work on line/area/tick — drop it if switching there.
      if (value === "line" || value === "area" || value === "tick") {
        for (const k of ["stroke", "strokeWidth"]) {
          const c = (enc[k] as Record<string, unknown> | undefined)?.condition as
            | Record<string, unknown>
            | undefined;
          if (typeof c?.test === "string" && c.test.includes("homeDistrict")) delete enc[k];
        }
      }
      return { ...s, mark: value, encoding: enc as ChartSpec["encoding"] };
    });
  }
  // Outline emphasis needs a mark with a separate fill + border.
  const markStr = typeof spec.mark === "string" ? spec.mark : "bar";
  const outlineOk = ["bar", "rect"].includes(markStr);

  // Point/marker options apply to scatter + line marks.
  const hasPoints = markStr === "point" || markStr === "line";
  const bubbleVal = typeof spec.points?.bubble === "string"
    ? spec.points.bubble
    : markStr === "line" ? "none" : "circle-outline";
  const pointSizeVal = typeof spec.points?.size === "number" ? spec.points.size : "";
  const sizeField = (spec.encoding?.size as Record<string, unknown> | undefined)?.field;
  const setBubble = (v: string) => setSpec((s) => ({ ...s, points: { ...(s.points ?? {}), bubble: v } }));
  const setPointSize = (raw: string) =>
    setSpec((s) => {
      const n = Number(raw);
      const points = { ...(s.points ?? {}) };
      if (raw.trim() !== "" && !Number.isNaN(n) && n > 0) points.size = n;
      else delete points.size;
      return { ...s, points: Object.keys(points).length ? points : undefined };
    });
  const setDataLabels = (on: boolean) => setSpec((s) => ({ ...s, dataLabels: on || undefined }));
  const canDataLabel = ["bar", "point", "line", "area", "tick"].includes(markStr);

  // When a bar chart has a field spanning multiple years, those years need to be
  // laid out — side by side (grouped) or stacked. Offer that as one clear choice.
  const multiYear = spec.data.fields.some((f) => f.years.length > 1);
  // Stacking only makes sense for additive quantities (counts, dollars) — never
  // rates, percents, means or scores, where summing years is meaningless.
  const stackable = spec.data.fields
    .filter((f) => f.years.length > 1)
    .every((f) => f.dataType === "count" || f.dataType === "currency");
  const barLayout = (() => {
    const xo = (spec.encoding?.xOffset as Record<string, unknown> | undefined)?.field;
    const col = (spec.encoding?.color as Record<string, unknown> | undefined)?.field;
    if (xo === "year") return "grouped";
    if (col === "year") return "stacked";
    return "overlapping";
  })();
  function setBarLayout(value: string) {
    setSpec((s) => {
      const enc = { ...(s.encoding ?? {}) } as Record<string, Record<string, unknown>>;
      if ((enc.xOffset as Record<string, unknown> | undefined)?.field === "year") delete enc.xOffset;
      if (value === "grouped") {
        enc.color = { field: "year", type: "nominal" };
        enc.xOffset = { field: "year", type: "nominal" };
      } else if (value === "stacked") {
        enc.color = { field: "year", type: "nominal" }; // no xOffset → Vega stacks by colour
      } else if ((enc.color as Record<string, unknown> | undefined)?.field === "year") {
        delete enc.color;
      }
      return { ...s, encoding: enc as ChartSpec["encoding"] };
    });
  }

  // Highlight the user's own district. "fade"/"outline" don't touch the colour
  // scheme; "color" recolours just their marks to a chosen colour (via a colour
  // condition that falls back to any existing colour-by for everyone else).
  const HL_TEST = "datum.homeDistrict === 'My district'";
  const DEFAULT_HL_COLOR = "#f59e0b";
  const hlConds = (k: string) => {
    const c = (spec.encoding?.[k] as Record<string, unknown> | undefined)?.condition as
      | Record<string, unknown>
      | undefined;
    return typeof c?.test === "string" && c.test.includes("homeDistrict");
  };
  const highlightMode = hlConds("opacity")
    ? "fade"
    : hlConds("stroke")
      ? "outline"
      : hlConds("color")
        ? "color"
        : "none";
  const highlightColor = (() => {
    const c = (spec.encoding?.color as Record<string, unknown> | undefined)?.condition as
      | Record<string, unknown>
      | undefined;
    return typeof c?.value === "string" ? c.value : DEFAULT_HL_COLOR;
  })();
  function setHighlightMode(mode: string, color = highlightColor) {
    setSpec((s) => {
      const enc = { ...(s.encoding ?? {}) } as Record<string, Record<string, unknown>>;
      // Remove any existing home-district highlight channels first.
      for (const k of ["opacity", "stroke", "strokeWidth"]) {
        const c = (enc[k] as Record<string, unknown> | undefined)?.condition as
          | Record<string, unknown>
          | undefined;
        if (typeof c?.test === "string" && c.test.includes("homeDistrict")) delete enc[k];
      }
      // Strip a colour highlight back to its underlying colour-by (or nothing).
      const col = enc.color as Record<string, unknown> | undefined;
      const colCond = col?.condition as Record<string, unknown> | undefined;
      if (typeof colCond?.test === "string" && colCond.test.includes("homeDistrict")) {
        if (typeof col?.field === "string") enc.color = { field: col.field, type: col.type };
        else delete enc.color;
      }

      if (mode === "fade") {
        enc.opacity = { condition: { test: HL_TEST, value: 1 }, value: 0.3 };
      } else if (mode === "outline") {
        enc.stroke = { condition: { test: HL_TEST, value: "#0f172a" }, value: null };
        enc.strokeWidth = { condition: { test: HL_TEST, value: 2.5 }, value: 0 };
      } else if (mode === "color") {
        const base = enc.color as Record<string, unknown> | undefined;
        enc.color =
          typeof base?.field === "string"
            ? { condition: { test: HL_TEST, value: color }, field: base.field, type: base.type }
            : { condition: { test: HL_TEST, value: color }, value: "#cbd5e1" };
      }
      return { ...s, encoding: enc as ChartSpec["encoding"] };
    });
  }

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
    const nm = name.trim() || spec.title?.trim() || "Untitled visualization";
    // Persist the AI conversation alongside the chart so it restores on load.
    const specToSave: ChartSpec = {
      ...spec,
      chat: aiMsgs.map((m) => ({ role: m.role, content: m.content, ...(m.error ? { error: true } : {}) })),
    };
    const res = chartId ? await updateChart(chartId, specToSave, nm) : await createChart(nm, specToSave);
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
    a.download = `${(name || "visualization").replace(/\s+/g, "-")}.${kind}`;
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
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Visualization name" className={`${input} min-w-[220px] flex-1`} />
        <button onClick={save} className={iconBtn} title="Save visualization">
          <Icon name="saveViewOrGroup" />
        </button>
        <IconMenu
          icon="export"
          title="Export visualization (SVG / PNG)"
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
          <select value={entType} onChange={(e) => applyBase(e.target.value as "districts" | "schools" | "both")} className={`${input} w-full`}>
            <option value="districts">Districts only</option>
            <option value="schools">Schools only</option>
            <option value="both">Districts &amp; schools</option>
          </select>
          <select value={county} onChange={(e) => { setCounty(e.target.value); applyBase(entType, e.target.value); }} className={`${input} w-full`}>
            <option value="">All counties</option>
            {counties.map((c) => (<option key={c} value={c}>{c}</option>))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Saved Group</span>
            <select
              value={provenance?.kind === "group" ? String(provenance.id) : ""}
              onChange={(e) => e.target.value && applyGroup(e.target.value)}
              className={`${input} flex-1`}
            >
              <option value="">{groups.length ? "Choose a group…" : "No saved groups"}</option>
              {groups.map((g) => (<option key={g.id} value={g.id}>{g.name} ({g.entityIds.length})</option>))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Saved View</span>
            <select
              value={provenance?.kind === "view" ? String(provenance.id) : ""}
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
          <button
            onClick={() => setGroupSave({ name: provenance?.name ?? "", err: null })}
            disabled={spec.data.entities.ids.length === 0}
            className={`${input} flex items-center justify-center gap-2 disabled:opacity-40`}
          >
            <Icon name="saveViewOrGroup" className="h-4 w-4" />
            Save as group ({spec.data.entities.ids.length})
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
                <span className="font-medium text-slate-700 dark:text-slate-200" title={metricByCode.get(f.metric)?.description ?? f.label}>{f.label}</span>
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
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search metrics…" className={`${input} w-full`} />
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
                            <button key={m.code} onClick={() => addField(m)} title={m.description ?? m.name} className="block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-left text-sm hover:border-indigo-300 dark:border-slate-800 dark:hover:border-indigo-700">
                              <span className="font-medium text-slate-700 dark:text-slate-200">{m.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              : metrics.map((m) => (
                  <button key={m.code} onClick={() => addField(m)} title={m.description ?? m.name} className="block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-left text-sm hover:border-indigo-300 dark:border-slate-800 dark:hover:border-indigo-700">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{m.name}</span>
                    <span className="block text-xs text-slate-400">{m.category}</span>
                  </button>
                ))}
          </div>
        </aside>

        {/* CENTER — canvas */}
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          {/* zoom + spec toggle, top-right of the graph */}
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
            {!showJson && canRender && (
              <div className="flex items-center gap-0.5 rounded-lg border border-slate-300 bg-white/90 dark:border-slate-700 dark:bg-slate-950/90">
                <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} className="px-2 text-lg leading-none text-slate-600 hover:text-slate-900 dark:text-slate-300" title="Zoom out">−</button>
                <button onClick={() => setZoom(1)} className="min-w-[2.75rem] py-1.5 text-center text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400" title="Reset zoom">{Math.round(zoom * 100)}%</button>
                <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} className="px-2 text-lg leading-none text-slate-600 hover:text-slate-900 dark:text-slate-300" title="Zoom in">+</button>
              </div>
            )}
            <button
              onClick={() => setShowJson((v) => !v)}
              className={showJson ? iconBtnActive : iconBtn}
              title={showJson ? "Back to visualization" : "Edit spec (JSON)"}
            >
              <Icon name="spec" />
            </button>
          </div>
          {showJson ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} className="min-h-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />
              {jsonErr && <p className="text-sm text-red-600">{jsonErr}</p>}
              <button onClick={applyJson} className="flex items-center gap-1.5 self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"><Icon name="apply" className="h-4 w-4" />Apply spec</button>
            </div>
          ) : canRender ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-white">
              <VegaChart spec={spec} rows={rows} labels={axisLabels} zoom={zoom} onView={onChartView} />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-slate-400">
              {resolving ? "Loading data…" : "Pick entities + add a field on the left, then map fields on the right."}
            </div>
          )}
        </section>

        {/* RIGHT — encoding */}
        <aside className="flex w-[22%] min-w-[220px] flex-col gap-3 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Visualization type</span>
            <select value={chartType} onChange={(e) => setChartType(e.target.value)} className={`${input} w-full`}>
              {MARK_OPTIONS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
            </select>
          </label>
          {chartType === "bar" && multiYear && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-600 dark:text-slate-300">Multiple years</span>
              <select value={barLayout} onChange={(e) => setBarLayout(e.target.value)} className={input}>
                <option value="grouped">Side by side (grouped)</option>
                <option value="stacked" disabled={!stackable}>
                  Stacked{stackable ? "" : " (n/a: not an additive measure)"}
                </option>
                <option value="overlapping">Overlapping (not recommended)</option>
              </select>
              <span className="text-[11px] text-slate-400">
                How to lay out the years for each district.
                {!stackable && " Stacking is off for rates and scores; summing years isn’t meaningful."}
              </span>
            </label>
          )}

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Fields</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Title</span>
            <input
              value={spec.title ?? provenance?.name ?? ""}
              onChange={(e) => setSpec((s) => ({ ...s, title: e.target.value || undefined }))}
              placeholder="Chart title"
              className={`${input} w-full`}
              style={{ color: spec.title == null && provenance?.name ? "#94a3b8" : undefined }}
              title={spec.title == null && provenance?.name ? "Default title (edit to override)" : "Chart title"}
            />
          </label>
          {PRIMARY_CHANNELS.map(({ ch, label, hint }) => {
            const def = spec.encoding?.[ch];
            // The x/y axes are always a measure: a data field or a record count —
            // never truly "none". An empty axis means "Count".
            const isAxis = ch === "x" || ch === "y";
            const selectValue = def?.field ?? (isAxis ? "__count__" : "");
            const showTitle = !!def?.field || isAxis;
            const defaultLabel = def?.field ? (axisLabels[def.field] ?? def.field) : "Count";
            return (
              <label key={ch} className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
                <select value={selectValue} onChange={(e) => setChannel(ch, e.target.value)} className={`${input} w-full`}>
                  {isAxis ? (
                    <option value="__count__">Count (number of records)</option>
                  ) : (
                    <option value="">— none —</option>
                  )}
                  {columns.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                </select>
                <SortSelect ch={ch} />
                {showTitle ? (
                  <input
                    value={(def?.title as string | undefined) ?? defaultLabel}
                    onChange={(e) => setChannelTitle(ch, e.target.value)}
                    className={`${input} w-full text-xs`}
                    style={{ color: def?.title == null ? "#94a3b8" : undefined }}
                    title={def?.title == null ? "Default label (edit to override)" : "Axis / legend label"}
                  />
                ) : (
                  hint && <span className="text-[11px] text-slate-400">{hint}</span>
                )}
              </label>
            );
          })}

          <button
            onClick={() => setAdvOpen((v) => !v)}
            className="mt-1 flex items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <span>{advOpen ? "▾" : "▸"}</span>
            <span>More layout options</span>
          </button>
          {advOpen &&
            ADVANCED_CHANNELS.filter(({ ch }) =>
              // Side-by-side bars only for bar charts; Bubble size lives in its
              // own Points section below; column/row faceting is always OK.
              ch === "size" ? false : ch === "xOffset" ? chartType === "bar" : true,
            ).map(({ ch, label, hint }) => {
              const def = spec.encoding?.[ch];
              const opts = columns.filter((c) => c.kind === "builtin");
              return (
                <label key={ch} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
                  <select value={def?.field ?? ""} onChange={(e) => setChannel(ch, e.target.value)} className={`${input} w-full`}>
                    <option value="">none</option>
                    {opts.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                  </select>
                  <SortSelect ch={ch} />
                  <span className="text-[11px] text-slate-400">{hint}</span>
                </label>
              );
            })}

          {hasPoints && (
            <>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Points</p>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-600 dark:text-slate-300">Bubble type</span>
                <select value={bubbleVal} onChange={(e) => setBubble(e.target.value)} className={`${input} w-full`}>
                  {BUBBLE_OPTIONS.map((o) => (<option key={o.v} value={o.v}>{o.label}</option>))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-600 dark:text-slate-300">Bubble size</span>
                <select value={(sizeField as string) ?? ""} onChange={(e) => setChannel("size", e.target.value)} className={`${input} w-full`}>
                  <option value="">Standard</option>
                  {columns.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
                </select>
                {!sizeField && (
                  <input
                    type="number"
                    min={1}
                    step="any"
                    value={pointSizeVal}
                    onChange={(e) => setPointSize(e.target.value)}
                    placeholder="size (px), auto"
                    className={`${input} w-full text-xs`}
                    style={{ color: pointSizeVal === "" ? "#94a3b8" : undefined }}
                  />
                )}
              </label>
            </>
          )}

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Style</p>
          {canDataLabel && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!spec.dataLabels} onChange={(e) => setDataLabels(e.target.checked)} />
              <span className="text-slate-600 dark:text-slate-300">Show data labels</span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={spec.showLegend !== false}
              onChange={(e) => setSpec((s) => ({ ...s, showLegend: e.target.checked }))}
            />
            <span className="text-slate-600 dark:text-slate-300">Show legend</span>
          </label>
          {homeDistrictName && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-600 dark:text-slate-300">Highlight my district</span>
              <div className="flex items-center gap-2">
                <select value={highlightMode} onChange={(e) => setHighlightMode(e.target.value)} className={`${input} flex-1`}>
                  <option value="none">None</option>
                  <option value="fade">Fade the others</option>
                  <option value="outline" disabled={!outlineOk}>
                    Outline it{outlineOk ? "" : " (n/a for this type)"}
                  </option>
                  <option value="color">Recolor it</option>
                </select>
                {highlightMode === "color" && (
                  <input
                    type="color"
                    value={highlightColor}
                    onChange={(e) => setHighlightMode("color", e.target.value)}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950"
                    title="Highlight colour"
                  />
                )}
              </div>
              <span className="text-[11px] text-slate-400">
                {highlightMode === "color"
                  ? "Recolours just your district to the chosen colour."
                  : "Emphasises your district without changing the colours."}
              </span>
            </label>
          )}
          {(["x", "y"] as const).map((ax) => {
            if (!isNumericAxis(ax)) return null;
            const ext = axisExtent(ax);
            // Show the effective default (data bounds) when Min/Max aren't set.
            const defaults: Record<"axisMin" | "axisMax" | "interval", number | ""> = {
              axisMin: ext.lo,
              axisMax: ext.hi,
              interval: "",
            };
            return (
              <div key={ax} className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{ax} axis</span>
                <div className="grid grid-cols-3 gap-2">
                  {(["axisMin", "axisMax", "interval"] as const).map((key) => {
                    const set = axisNumOf(ax, key);
                    return (
                      <label key={key} className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
                        {key === "axisMin" ? "Min" : key === "axisMax" ? "Max" : "Interval"}
                        <input
                          type="number"
                          step="any"
                          value={set !== "" ? set : defaults[key]}
                          onChange={(e) => setAxisNum(ax, key, e.target.value)}
                          placeholder="auto"
                          className={`${input} w-full`}
                          style={{ color: set === "" ? "#94a3b8" : undefined }}
                          title={set === "" ? "Default (edit to override)" : undefined}
                        />
                      </label>
                    );
                  })}
                </div>
                <span className="text-[11px] text-slate-400">
                  Set Min, Max and the spacing between ticks (e.g. 0 / 20 / 5 → 0, 5, 10, 15, 20).
                </span>
              </div>
            );
          })}
          {chartType === "histogram" && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Buckets (x)</span>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
                  Range size
                  <input
                    type="number"
                    step="any"
                    value={binOf().step}
                    disabled={binOf().maxbins !== ""}
                    onChange={(e) => setBin("step", e.target.value)}
                    placeholder="auto"
                    className={`${input} w-full disabled:opacity-40`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
                  # of buckets
                  <input
                    type="number"
                    step="1"
                    value={binOf().maxbins}
                    disabled={binOf().step !== ""}
                    onChange={(e) => setBin("maxbins", e.target.value)}
                    placeholder="auto"
                    className={`${input} w-full disabled:opacity-40`}
                  />
                </label>
              </div>
              <span className="text-[11px] text-slate-400">
                Set one or the other (or leave both blank for automatic).
              </span>
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Palette</span>
            <select value={spec.theme} onChange={(e) => setSpec((s) => ({ ...s, theme: e.target.value as ChartSpec["theme"] }))} className={input}>
              <option value="app">App colors</option>
              <option value="print">Print (neutral)</option>
            </select>
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
          <span className="text-slate-400">{aiOpen ? "▼" : "▲"}</span>
        </button>
        {aiOpen && (
          <div className="flex h-56 flex-col border-t border-slate-200 dark:border-slate-800">
            <div ref={aiScroll} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {aiMsgs.length === 0 && (
                <p className="text-sm text-slate-400">
                  Try “compare 4-year graduation rates for these districts” or “which of these
                  metrics would show equity gaps best?” I’ll build the visualization and answer questions.
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

      {groupSave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setGroupSave(null)}>
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Save as group</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Save these {spec.data.entities.ids.length} entities as a reusable group.
            </p>
            <input
              autoFocus
              value={groupSave.name}
              onChange={(e) => setGroupSave({ name: e.target.value, err: null })}
              onKeyDown={(e) => { if (e.key === "Enter" && groupSave.name.trim()) void saveGroup(groupSave.name.trim()); }}
              placeholder="Group name"
              className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {groupSave.err && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{groupSave.err}</p>}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={() => setGroupSave(null)} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Icon name="no" className="h-4 w-4" />Cancel</button>
              <button
                disabled={!groupSave.name.trim()}
                onClick={() => void saveGroup(groupSave.name.trim())}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                <Icon name="saveViewOrGroup" className="h-4 w-4" />
                Save group
              </button>
            </div>
          </div>
        </div>
      )}

      {groupConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setGroupConflict(null)}>
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Name already used</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              A group named “{groupConflict.name}” already exists. Overwrite it, or save as new?
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button onClick={() => setGroupConflict(null)} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Icon name="no" className="h-4 w-4" />Cancel</button>
              <button onClick={() => void resolveGroupConflict("new")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Save as new</button>
              <button onClick={() => void resolveGroupConflict("overwrite")} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500">Overwrite</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
