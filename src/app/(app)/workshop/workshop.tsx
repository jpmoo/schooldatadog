"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Icon } from "@/components/icon";
import { IconMenu } from "@/components/icon-menu";
import { createGroup, overwriteGroup } from "@/lib/groups/actions";
import type { GroupLite } from "@/lib/groups/queries";
import { createView, overwriteView } from "@/lib/views/actions";
import { getColumnValues, getMetricSubgroups, searchMetrics } from "@/lib/workshop/actions";
import type { WorkshopEntity } from "@/lib/workshop/queries";
import type { MetricLite } from "@/lib/workshop/types";
import { CalcDialog, type CalcConfig } from "./calc-dialog";
import {
  ALL_STUDENTS,
  compareBySortKeys,
  computeCalc,
  formatCalc,
  formatValue,
  type CalcColumn,
  type Column,
  type DataColumn,
  type SavedViewState,
  type SortKey,
} from "./columns";

const natCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

// ── data export (CSV / Excel / print-to-PDF) ──────────────────────────────
function colLabel(col: Column): string {
  if (col.kind === "data") {
    const sg = col.subgroup !== ALL_STUDENTS ? ` · ${col.subgroup}` : "";
    return `${col.metric.name} (${col.year})${sg}`;
  }
  return `ƒ ${col.name}`;
}
const escHtml = (v: string | number) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function tableHtml(header: (string | number)[], data: (string | number)[][]) {
  const th = `<tr>${header.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr>`;
  const tb = data.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join("")}</tr>`).join("");
  return `<table>${th}${tb}</table>`;
}
function exportCsv(header: (string | number)[], data: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...data].map((r) => r.map(esc).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "data-workshop.csv");
}
async function exportExcel(header: (string | number)[], data: (string | number)[][]) {
  const writeXlsxFile = (await import("write-excel-file/browser")).default;
  const headerRow = header.map((h) => ({ value: String(h), fontWeight: "bold", type: String }));
  const rows = data.map((r) =>
    r.map((c) => (typeof c === "number" ? { type: Number, value: c } : c === "" ? null : { type: String, value: String(c) })),
  );
  await writeXlsxFile([headerRow, ...rows] as never).toFile("data-workshop.xlsx");
}
function exportPdf(header: (string | number)[], data: (string | number)[][]) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(
    `<html><head><title>Data Workshop</title><style>body{font-family:sans-serif;margin:16px}table{border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd5e1;padding:2px 6px;text-align:left}th{background:#f1f5f9}</style></head><body>${tableHtml(header, data)}</body></html>`,
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ── drag sources / drop targets ───────────────────────────────────────────

function MetricChip({ metric }: { metric: MetricLite }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `metric:${metric.code}`,
    data: { type: "metric", metric },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`cursor-grab rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900 ${
        isDragging ? "opacity-40" : ""
      }`}
      title={metric.code}
    >
      <div className="font-medium text-slate-800 dark:text-slate-100">{metric.name}</div>
      <div className="text-xs text-slate-400">
        {metric.category}
        {metric.unit ? ` · ${metric.unit}` : ""}
      </div>
    </div>
  );
}

function CalcSource() {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: "calc-source",
    data: { type: "calc" },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="flex cursor-grab items-center gap-2 rounded-lg border border-dashed border-indigo-400 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 active:cursor-grabbing dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
    >
      <Icon name="calcualtedField" className="h-4 w-4" />
      Calculated Field <span className="text-xs font-normal">(drag onto the sheet)</span>
    </div>
  );
}

function ColumnHeader({
  col,
  sortLabel,
  onContext,
  onRemove,
}: {
  col: Column;
  sortLabel: string;
  onContext: (e: React.MouseEvent, col: Column) => void;
  onRemove: (id: string) => void;
}) {
  const drag = useDraggable({ id: `col:${col.id}`, data: { type: "col" } });
  const drop = useDroppable({ id: `drop-${col.id}` });
  const setRef = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  };
  const title = col.kind === "data" ? col.metric.name : col.name;
  const sub = col.kind === "data" ? col.year : "calculated";
  const subgroup = col.kind === "data" && col.subgroup !== ALL_STUDENTS ? col.subgroup : null;

  return (
    <th
      ref={setRef}
      data-colid={col.id}
      onContextMenu={(e) => onContext(e, col)}
      className={`sticky top-0 z-10 min-w-[140px] cursor-grab border-b border-l border-slate-200 bg-slate-50 px-3 py-2 text-left align-top dark:border-slate-800 dark:bg-slate-900 ${
        drop.isOver ? "bg-indigo-100 dark:bg-indigo-950" : ""
      } ${drag.isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span {...drag.listeners} {...drag.attributes} className="flex-1">
          <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">
            {title} <span className="font-normal text-indigo-500">{sortLabel}</span>
          </span>
          <span className="block text-[11px] font-normal text-slate-400">
            {col.kind === "calc" ? "ƒ " : ""}
            {sub}
          </span>
          {subgroup && (
            <span className="mt-0.5 block truncate rounded bg-indigo-100 px-1 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              {subgroup}
            </span>
          )}
        </span>
        <button
          onClick={() => onRemove(col.id)}
          className="text-slate-300 hover:text-red-500"
          title="Remove column"
        >
          ✕
        </button>
      </div>
    </th>
  );
}

function SheetDrop({
  children,
  scrollRef,
}: {
  children: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "sheet" });
  return (
    <div
      ref={(n) => {
        setNodeRef(n);
        scrollRef.current = n;
      }}
      className={`min-h-0 flex-1 overflow-auto rounded-lg border ${
        isOver ? "border-indigo-400" : "border-slate-200 dark:border-slate-800"
      }`}
    >
      {children}
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────

type Row = { entity: WorkshopEntity; type: "district" | "school"; collapsible: boolean; rank: string };
type ViewMode = "districts" | "both" | "schools";
type Ctx = { key: string; kind: "name" | "data" | "calc"; calcId?: string; x: number; y: number };

export function Workshop({
  years,
  counties,
  entities,
  initialMetrics,
  initialGroups,
  demographicMetrics,
  initialView,
  initialViewName,
  homeDistrictId,
}: {
  years: string[];
  counties: string[];
  entities: WorkshopEntity[];
  initialMetrics: MetricLite[];
  initialGroups: GroupLite[];
  demographicMetrics: string[];
  initialView: SavedViewState | null;
  initialViewName: string | null;
  homeDistrictId: number | null;
}) {
  const demographicSet = useMemo(() => new Set(demographicMetrics), [demographicMetrics]);
  const [year, setYear] = useState(years[0] ?? "");
  const [query, setQuery] = useState("");
  const [metrics, setMetrics] = useState<MetricLite[]>(initialMetrics);
  const [isSearching, startSearch] = useTransition();

  const [viewMode, setViewMode] = useState<ViewMode>("districts");
  const [county, setCounty] = useState("");
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [entityPanel, setEntityPanel] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [hideEmpty, setHideEmpty] = useState(false);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groups, setGroups] = useState<GroupLite[]>(initialGroups);
  const [groupFilter, setGroupFilter] = useState("");
  const [groupDialog, setGroupDialog] = useState(false);
  const [viewDialog, setViewDialog] = useState(false);
  const [viewName, setViewName] = useState(initialViewName);
  const [confirmClear, setConfirmClear] = useState(false);
  const [viewConflict, setViewConflict] = useState<{ name: string; id: number; state: SavedViewState } | null>(null);
  const [groupConflict, setGroupConflict] = useState<{ name: string; id: number; ids: number[] } | null>(null);

  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [districtSort, setDistrictSort] = useState<SortKey[]>([]);
  const [schoolSort, setSchoolSort] = useState<SortKey[]>([]);

  const [calcDialog, setCalcDialog] = useState<{ editId: string | null } | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [dragging, setDragging] = useState<{ kind: string; label: string } | null>(null);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [subgroupCol, setSubgroupCol] = useState<DataColumn | null>(null);
  const [paneHidden, setPaneHidden] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const homeCycleRef = useRef(0); // schools-only: which home-district school to jump to next

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Re-run search whenever the query OR the selected year changes (the year
  // restricts the list to metrics that actually have data that year).
  useEffect(() => {
    const t = setTimeout(() => {
      startSearch(async () => setMetrics(await searchMetrics(query, year)));
    }, 250);
    return () => clearTimeout(t);
  }, [query, year]);

  // Keep the saved-groups dropdown in sync with the server after a mutation
  // (the create action revalidates, delivering a fresh initialGroups here) so a
  // newly saved group appears without a manual page refresh.
  useEffect(() => {
    setGroups(initialGroups);
  }, [initialGroups]);

  // ── derived data ──
  const visibleEntities = useMemo(
    () =>
      entities.filter((e) => {
        if (viewMode === "districts" && e.type !== "district") return false;
        if (viewMode === "schools" && e.type !== "school") return false;
        if (county && e.county !== county) return false;
        if (hidden.has(e.id)) return false;
        return true;
      }),
    [entities, viewMode, county, hidden],
  );
  const visibleIds = useMemo(() => visibleEntities.map((e) => e.id), [visibleEntities]);

  const columnsById = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.id, c])) as Record<string, Column>,
    [columns],
  );
  const orderIndex = useMemo(
    () => Object.fromEntries(columns.map((c, i) => [c.id, i])),
    [columns],
  );

  const calcValues = useMemo(() => {
    const res: Record<string, Record<number, number | null>> = {};
    for (const c of columns) {
      if (c.kind !== "calc") continue;
      const ordered = [...c.sourceIds].sort(
        (a, b) => (orderIndex[a] ?? 1e9) - (orderIndex[b] ?? 1e9),
      );
      res[c.id] = computeCalc({ ...c, sourceIds: ordered }, visibleIds, columnsById);
    }
    return res;
  }, [columns, columnsById, orderIndex, visibleIds]);

  const getVal = (col: Column, entityId: number): number | null => {
    if (col.kind === "data") {
      const v = col.values[entityId];
      return v === undefined ? null : v;
    }
    return calcValues[col.id]?.[entityId] ?? null;
  };
  const valueOf = (key: string, entityId: number): number | string | null => {
    if (key === "name") return null;
    const col = columnsById[key];
    return col ? getVal(col, entityId) : null;
  };

  // ── build rows (tree in "both" view) ──
  const rows = useMemo(() => {
    const cmpD = (a: WorkshopEntity, b: WorkshopEntity) =>
      compareBySortKeys(districtSort, valueOf, a, b);
    const cmpS = (a: WorkshopEntity, b: WorkshopEntity) =>
      compareBySortKeys(schoolSort, valueOf, a, b);

    // An entity is "empty" when every present column is null for it.
    const isEmpty = (id: number) => columns.length > 0 && columns.every((c) => getVal(c, id) === null);
    const show = (id: number) => !hideEmpty || !isEmpty(id);

    // Flat list: districts-only or schools-only.
    if (viewMode !== "both") {
      const type = viewMode === "schools" ? "school" : "district";
      return [...visibleEntities]
        .filter((e) => show(e.id))
        .sort(cmpD)
        .map((e, i) => ({ entity: e, type, collapsible: false, rank: String(i + 1) }));
    }

    const districts = visibleEntities.filter((e) => e.type === "district").sort(cmpD);
    const schools = visibleEntities.filter((e) => e.type === "school");
    const byParent = new Map<number, WorkshopEntity[]>();
    for (const s of schools) {
      const p = s.parentDistrictId;
      if (p == null) continue;
      (byParent.get(p) ?? byParent.set(p, []).get(p)!).push(s);
    }
    const districtIds = new Set(districts.map((d) => d.id));
    const out: Row[] = [];
    // Districts rank 1..N; each school ranks "[district].[school-within-district]".
    let districtRank = 0;
    for (const d of districts) {
      const kids = (byParent.get(d.id) ?? []).filter((s) => show(s.id));
      // Keep a district if it has data itself or has any shown school under it.
      if (!show(d.id) && kids.length === 0) continue;
      districtRank++;
      out.push({ entity: d, type: "district", collapsible: kids.length > 0, rank: String(districtRank) });
      if (kids.length && !collapsed.has(d.id)) {
        [...kids].sort(cmpS).forEach((s, si) =>
          out.push({ entity: s, type: "school", collapsible: false, rank: `${districtRank}.${si + 1}` }),
        );
      }
    }
    const orphans = schools.filter(
      (s) => (s.parentDistrictId == null || !districtIds.has(s.parentDistrictId)) && show(s.id),
    );
    orphans.sort(cmpS).forEach((s, oi) =>
      out.push({ entity: s, type: "school", collapsible: false, rank: String(oi + 1) }),
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEntities, viewMode, districtSort, schoolSort, collapsed, calcValues, columns, hideEmpty]);

  // Bring a just-added column into view (jump the sheet's horizontal scroll).
  function scrollToColumn(id: string) {
    setTimeout(() => {
      scrollRef.current
        ?.querySelector(`[data-colid="${id}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "end", behavior: "smooth" });
    }, 60);
  }

  // ── column ops ──
  // Duplicates are allowed — the same metric can legitimately appear more than
  // once (e.g. different demographic slices, or the same slice for comparison).
  async function addDataColumn(metric: MetricLite, yr: string, subgroup = ALL_STUDENTS) {
    const id = `data-${metric.code}-${yr}-${columns.length}-${Math.round(performance.now())}`;
    setColumns((cs) => [...cs, { id, kind: "data", metric, year: yr, subgroup, values: {} }]);
    scrollToColumn(id);
    setLoading((s) => new Set(s).add(id));
    const vals = await getColumnValues(metric.code, yr, subgroup);
    const map: Record<number, number | null> = {};
    for (const v of vals) map[v.entityId] = v.value;
    setColumns((cs) => cs.map((c) => (c.id === id ? { ...(c as DataColumn), values: map } : c)));
    setLoading((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }

  // Reconcile the demographic columns for a metric/year to exactly `subgroups`:
  // add a column per newly-checked demographic, drop columns for unchecked ones.
  // (Each demographic is a separate column — NYSED reports one breakdown at a
  // time, so a true cross-tab like "Hispanic AND non-poverty" isn't in the data.)
  async function applyColumnSubgroups(baseColId: string, subgroups: string[]) {
    const base = columns.find((c) => c.id === baseColId);
    if (!base || base.kind !== "data") return;
    const { metric, year } = base;
    const want = new Set(subgroups);

    const existing = columns.filter(
      (c): c is DataColumn => c.kind === "data" && c.metric.code === metric.code && c.year === year,
    );
    const existingSubs = new Set(existing.map((c) => c.subgroup));
    const removeIds = new Set(existing.filter((c) => !want.has(c.subgroup)).map((c) => c.id));
    const addSubs = subgroups.filter((sg) => !existingSubs.has(sg));

    const stamp = Math.round(performance.now());
    const newCols: DataColumn[] = addSubs.map((sg, k) => ({
      id: `data-${metric.code}-${year}-${stamp}-${k}`,
      kind: "data",
      metric,
      year,
      subgroup: sg,
      values: {},
    }));

    setColumns((cs) => {
      const kept = cs
        .filter((c) => !removeIds.has(c.id))
        .map((c) =>
          c.kind === "calc" ? { ...c, sourceIds: c.sourceIds.filter((id) => !removeIds.has(id)) } : c,
        );
      // Insert the new columns right after the metric's last surviving column.
      let insertAt = kept.length;
      for (let idx = kept.length - 1; idx >= 0; idx--) {
        const c = kept[idx];
        if (c.kind === "data" && c.metric.code === metric.code && c.year === year) {
          insertAt = idx + 1;
          break;
        }
      }
      return [...kept.slice(0, insertAt), ...newCols, ...kept.slice(insertAt)];
    });

    if (newCols.length === 0) return;
    scrollToColumn(newCols[0].id);
    setLoading((s) => {
      const n = new Set(s);
      newCols.forEach((c) => n.add(c.id));
      return n;
    });
    await Promise.all(
      newCols.map(async (c) => {
        const vals = await getColumnValues(metric.code, year, c.subgroup);
        const map: Record<number, number | null> = {};
        for (const v of vals) map[v.entityId] = v.value;
        setColumns((cs) => cs.map((x) => (x.id === c.id ? { ...(x as DataColumn), values: map } : x)));
        setLoading((s) => {
          const n = new Set(s);
          n.delete(c.id);
          return n;
        });
      }),
    );
  }

  function submitCalc(config: CalcConfig) {
    const editId = calcDialog?.editId ?? null;
    if (editId) {
      setColumns((cs) =>
        cs.map((c) =>
          c.id === editId && c.kind === "calc"
            ? { ...c, ...config, id: editId, kind: "calc" }
            : c,
        ),
      );
    } else {
      const id = `calc-${columns.length}-${Math.round(performance.now())}`;
      setColumns((cs) => [...cs, { id, kind: "calc", ...config }]);
      scrollToColumn(id);
    }
    setCalcDialog(null);
  }

  const removeColumn = (id: string) =>
    setColumns((cs) =>
      cs
        .filter((c) => c.id !== id)
        .map((c) =>
          c.kind === "calc" ? { ...c, sourceIds: c.sourceIds.filter((s) => s !== id) } : c,
        ),
    );

  // Reorder just the calc's source columns among the slots they already hold,
  // so the sheet's column order matches what the dialog shows.
  function reorderSelected(orderedIds: string[]) {
    setColumns((cs) => {
      const idSet = new Set(orderedIds);
      const slots: number[] = [];
      cs.forEach((c, i) => {
        if (idSet.has(c.id)) slots.push(i);
      });
      if (slots.length !== orderedIds.length) return cs;
      const byId = new Map(cs.map((c) => [c.id, c]));
      const arr = [...cs];
      slots.forEach((slot, k) => {
        arr[slot] = byId.get(orderedIds[k])!;
      });
      return arr;
    });
  }

  function reorder(fromId: string, toId: string) {
    setColumns((cs) => {
      const from = cs.findIndex((c) => c.id === fromId);
      const to = cs.findIndex((c) => c.id === toId);
      if (from < 0 || to < 0 || from === to) return cs;
      const arr = [...cs];
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      return arr;
    });
  }

  // ── sorting helpers ──
  function applySort(level: "district" | "school", key: string, dir: "asc" | "desc", add: boolean) {
    const setter = level === "district" ? setDistrictSort : setSchoolSort;
    setter((prev) => {
      const rest = prev.filter((k) => k.key !== key);
      return add ? [...rest, { key, dir }] : [{ key, dir }];
    });
    setCtx(null);
  }
  const clearSorts = () => {
    setDistrictSort([]);
    setSchoolSort([]);
    setCtx(null);
  };
  function sortLabel(key: string): string {
    const parts: string[] = [];
    const d = districtSort.findIndex((k) => k.key === key);
    if (d >= 0)
      parts.push((districtSort[d].dir === "asc" ? "▲" : "▼") + (districtSort.length > 1 ? d + 1 : ""));
    const s = schoolSort.findIndex((k) => k.key === key);
    if (s >= 0 && viewMode === "both")
      parts.push("ˢ" + (schoolSort[s].dir === "asc" ? "▲" : "▼"));
    return parts.join(" ");
  }

  const collapseAll = () =>
    setCollapsed(new Set(visibleEntities.filter((e) => e.type === "district").map((e) => e.id)));
  const expandAll = () => setCollapsed(new Set());

  function scrollToHome() {
    if (homeDistrictId == null) return;
    const home = entities.find((e) => e.id === homeDistrictId);
    if (!home) return;
    if (county && home.county !== county) setCounty(""); // reveal it
    if (hidden.has(homeDistrictId)) {
      const n = new Set(hidden);
      n.delete(homeDistrictId);
      setHidden(n);
    }
    setTimeout(() => {
      scrollRef.current
        ?.querySelector(`[data-eid="${homeDistrictId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
  }

  // Schools-only: step through the home district's schools one per click, wrapping.
  function cycleHomeSchool() {
    if (homeDistrictId == null) return;
    const homeSchools = rows.filter((r) => r.entity.parentDistrictId === homeDistrictId);
    if (homeSchools.length === 0) {
      if (county) setCounty(""); // reveal them; click again to start cycling
      return;
    }
    const idx = homeCycleRef.current % homeSchools.length;
    homeCycleRef.current = idx + 1;
    const eid = homeSchools[idx].entity.id;
    setTimeout(() => {
      scrollRef.current
        ?.querySelector(`[data-eid="${eid}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  }

  // ── selection & saved groups ──
  // Manual visibility edits (panel, "show only") clear any active group choice.
  function applyHidden(next: Set<number>) {
    setHidden(next);
    setGroupFilter("");
  }
  /** Set of every entity NOT in `keep` — i.e. hide everything else. */
  function complement(keep: Set<number>): Set<number> {
    const next = new Set<number>();
    for (const e of entities) if (!keep.has(e.id)) next.add(e.id);
    return next;
  }
  function toggleSelected(id: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function showOnlySelected() {
    applyHidden(complement(selected));
    setSelected(new Set());
  }
  function applyGroup(value: string) {
    setGroupFilter(value);
    if (!value) {
      setHidden(new Set());
      return;
    }
    const g = groups.find((x) => String(x.id) === value);
    if (g) setHidden(complement(new Set(g.entityIds)));
  }
  function addGroupToList(g: GroupLite) {
    setGroups((gs) =>
      [...gs.filter((x) => x.id !== g.id), g].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
  async function handleCreateGroup(name: string) {
    const ids = [...selected];
    const res = await createGroup(name, ids);
    if (res.ok) {
      addGroupToList(res.group);
      setGroupDialog(false);
      setSelected(new Set());
      return { ok: true };
    }
    if ("conflict" in res) {
      setGroupConflict({ name, id: res.conflict.id, ids });
      setGroupDialog(false);
      return { ok: true }; // resolved via the overwrite/save-new prompt
    }
    return res;
  }
  async function resolveGroupConflict(mode: "overwrite" | "new") {
    if (!groupConflict) return;
    const { name, id, ids } = groupConflict;
    const res =
      mode === "overwrite" ? await overwriteGroup(id, ids) : await createGroup(name, ids, true);
    if (res.ok) {
      addGroupToList(res.group);
      setSelected(new Set());
    }
    setGroupConflict(null);
  }

  // ── saved views ──
  function captureState(): SavedViewState {
    return {
      year,
      viewMode,
      county,
      hidden: [...hidden],
      collapsed: [...collapsed],
      districtSort,
      schoolSort,
      groupFilter,
      hideEmpty,
      columns: columns.map((c) =>
        c.kind === "data"
          ? { id: c.id, kind: "data", metric: c.metric, year: c.year, subgroup: c.subgroup }
          : c,
      ),
    };
  }
  async function fetchColumnValues(cols: DataColumn[]) {
    setLoading((s) => {
      const n = new Set(s);
      cols.forEach((c) => n.add(c.id));
      return n;
    });
    await Promise.all(
      cols.map(async (c) => {
        const vals = await getColumnValues(c.metric.code, c.year, c.subgroup);
        const map: Record<number, number | null> = {};
        for (const v of vals) map[v.entityId] = v.value;
        setColumns((cs) => cs.map((x) => (x.id === c.id ? { ...(x as DataColumn), values: map } : x)));
        setLoading((s) => {
          const n = new Set(s);
          n.delete(c.id);
          return n;
        });
      }),
    );
  }
  function applyView(v: SavedViewState) {
    setYear(v.year);
    setViewMode(v.viewMode);
    setCounty(v.county);
    setHidden(new Set(v.hidden));
    setCollapsed(new Set(v.collapsed));
    setDistrictSort(v.districtSort);
    setSchoolSort(v.schoolSort);
    setGroupFilter(v.groupFilter);
    setHideEmpty(v.hideEmpty ?? false);
    const cols: Column[] = v.columns.map((c) =>
      c.kind === "data"
        ? {
            id: c.id,
            kind: "data",
            metric: c.metric,
            year: c.year,
            subgroup: c.subgroup ?? ALL_STUDENTS,
            values: {},
          }
        : c,
    );
    setColumns(cols);
    void fetchColumnValues(cols.filter((c): c is DataColumn => c.kind === "data"));
  }
  // Reset the sheet back to a blank slate (columns, filters, sorts, selection).
  function clearWorkshop() {
    setColumns([]);
    setLoading(new Set());
    setDistrictSort([]);
    setSchoolSort([]);
    setHidden(new Set());
    setCollapsed(new Set());
    setSelected(new Set());
    setCounty("");
    setGroupFilter("");
    setViewMode("districts");
    setHideEmpty(false);
    setViewName(null);
    setConfirmClear(false);
  }
  // Export the currently-displayed sheet (rank + name + every column).
  function exportSheet(format: "csv" | "excel" | "pdf") {
    const header: (string | number)[] = ["Rank", "School / District", ...columns.map(colLabel)];
    const data = rows.map(({ entity: e, rank }) => [
      rank,
      e.name,
      ...columns.map((col) => {
        const v = getVal(col, e.id);
        return v == null ? "" : v;
      }),
    ]);
    if (format === "csv") exportCsv(header, data);
    else if (format === "excel") exportExcel(header, data);
    else exportPdf(header, data);
  }
  async function handleSaveView(name: string) {
    const state = captureState();
    const res = await createView(name, state);
    if (res.ok) {
      setViewName(res.view.name);
      setViewDialog(false);
      return { ok: true };
    }
    if ("conflict" in res) {
      setViewConflict({ name, id: res.conflict.id, state });
      setViewDialog(false);
      return { ok: true }; // resolved via the overwrite/save-new prompt
    }
    return res;
  }
  async function resolveViewConflict(mode: "overwrite" | "new") {
    if (!viewConflict) return;
    const { name, id, state } = viewConflict;
    const res =
      mode === "overwrite" ? await overwriteView(id, state) : await createView(name, state, true);
    if (res.ok) setViewName(res.view.name);
    setViewConflict(null);
  }

  // Restore a saved view once, when opened via /workshop?view=<id>.
  const appliedView = useRef(false);
  useEffect(() => {
    if (initialView && !appliedView.current) {
      appliedView.current = true;
      applyView(initialView);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── drag handlers ──
  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    if (id.startsWith("metric:"))
      setDragging({ kind: "metric", label: (e.active.data.current?.metric as MetricLite)?.name ?? "" });
    else if (id === "calc-source") setDragging({ kind: "calc", label: "Calculated Field" });
    else if (id.startsWith("col:")) {
      const col = columnsById[id.slice(4)];
      setDragging({ kind: "col", label: col?.kind === "data" ? col.metric.name : "column" });
    }
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const { active, over } = e;
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a.startsWith("metric:")) {
      const m = active.data.current?.metric as MetricLite | undefined;
      if (m) void addDataColumn(m, year);
    } else if (a === "calc-source") {
      setCalcDialog({ editId: null });
    } else if (a.startsWith("col:")) {
      const colId = a.slice(4);
      if (o.startsWith("drop-")) reorder(colId, o.slice(5)); // reorder only; ✕ removes
    }
  }

  const dataColumns = columns.filter((c): c is DataColumn => c.kind === "data");
  const districtOptions = useMemo(
    () =>
      entities
        .filter((e) => e.type === "district")
        .map((e) => ({ id: e.id, name: e.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entities],
  );
  const editingCalc =
    calcDialog?.editId != null
      ? (columns.find((c) => c.id === calcDialog.editId) as CalcColumn | undefined)
      : undefined;

  const grouped = useMemo(() => {
    if (query.trim()) return null;
    const map = new Map<string, MetricLite[]>();
    for (const m of metrics) (map.get(m.category ?? "Other") ?? map.set(m.category ?? "Other", []).get(m.category ?? "Other")!).push(m);
    return [...map.entries()].map(
      ([cat, list]) => [cat, [...list].sort((a, b) => natCompare(a.name, b.name))] as const,
    );
  }, [metrics, query]);

  if (!mounted) {
    return (
      <div className="flex h-[calc(100vh-6.5rem)] items-center justify-center text-sm text-slate-400">
        Loading the workshop…
      </div>
    );
  }

  // Fixed height keeps buttons and selects the same size in the filter row.
  const btn = "h-9 rounded-lg border border-slate-300 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
  const iconBtn =
    "flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800";
  const iconBtnActive =
    "flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500 bg-indigo-600 text-white";

  // With no explicit sort on a level, rows fall back to A→Z by name — surface
  // that default in the name column header.
  const nameSortsByDefault =
    districtSort.length === 0 || (viewMode === "both" && schoolSort.length === 0);

  return (
    <>
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex h-[calc(100vh-6.5rem)] gap-3" onClick={() => ctx && setCtx(null)}>
        {/* LEFT — metrics panel, collapsible to a slim strip on the left edge */}
        {paneHidden ? (
          <button
            onClick={() => setPaneHidden(false)}
            title="Show metrics panel"
            className="flex w-9 shrink-0 items-start justify-center rounded-lg border border-slate-200 bg-white pt-1.5 text-slate-500 hover:text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:hover:text-slate-200"
          >
            <Icon name="showHidePanel" flip className="h-6 w-6" />
          </button>
        ) : (
        <aside className="flex w-[30%] min-w-[260px] flex-col gap-3 overflow-hidden px-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold uppercase tracking-wide text-slate-400">Metrics</span>
            <button
              onClick={() => setPaneHidden(true)}
              title="Hide metrics panel"
              className="text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            >
              <Icon name="showHidePanel" className="h-6 w-6" />
            </button>
          </div>
          <CalcSource />
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Year</label>
            <select value={year} onChange={(e) => setYear(e.target.value)} className={`flex-1 ${btn}`}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search metrics (keyword + meaning)…"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          {grouped && grouped.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <button
                onClick={() => setOpenCats(new Set(grouped.map(([c]) => c)))}
                className="hover:text-slate-700 dark:hover:text-slate-200"
              >
                Expand all
              </button>
              <button
                onClick={() => setOpenCats(new Set())}
                className="hover:text-slate-700 dark:hover:text-slate-200"
              >
                Collapse all
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {isSearching && <p className="text-xs text-slate-400">Searching…</p>}
            {grouped
              ? grouped.map(([cat, list]) => {
                  const open = openCats.has(cat);
                  return (
                    <div key={cat}>
                      <button
                        onClick={() =>
                          setOpenCats((prev) => {
                            const n = new Set(prev);
                            if (n.has(cat)) n.delete(cat);
                            else n.add(cat);
                            return n;
                          })
                        }
                        className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-slate-50 py-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 dark:bg-slate-950 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
                        <span className="flex-1">{cat}</span>
                        <span className="font-normal text-slate-400">{list.length}</span>
                      </button>
                      {open && (
                        <div className="space-y-1.5 py-1">
                          {list.map((m) => (
                            <MetricChip key={m.code} metric={m} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              : metrics.map((m) => <MetricChip key={m.code} metric={m} />)}
            {metrics.length === 0 && !isSearching && (
              <p className="text-sm text-slate-400">No metrics match.</p>
            )}
          </div>
        </aside>
        )}

        {/* RIGHT 70% (full width when the left pane is hidden) */}
        <section className="flex flex-1 flex-col gap-2 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm dark:border-slate-800 dark:bg-slate-900">
            <select value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)} className={btn}>
              <option value="districts">Districts only</option>
              <option value="schools">Schools only</option>
              <option value="both">Districts &amp; schools</option>
            </select>
            <select value={county} onChange={(e) => setCounty(e.target.value)} className={btn}>
              <option value="">All counties</option>
              {counties.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={groupFilter}
              onChange={(e) => applyGroup(e.target.value)}
              className={btn}
              title="Saved groups"
            >
              <option value="">Saved groups…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.entityIds.length})
                </option>
              ))}
            </select>
            <button onClick={() => setEntityPanel((v) => !v)} className={btn}>
              Entities ({hidden.size > 0 ? `${hidden.size} hidden` : "all shown"})
            </button>
            <button
              onClick={() => setHideEmpty((v) => !v)}
              aria-pressed={hideEmpty}
              className={hideEmpty ? iconBtnActive : iconBtn}
              title={hideEmpty ? "Show empty rows" : "Hide rows with no data in any column"}
            >
              <Icon name="showHideEmpty" />
            </button>
            {homeDistrictId != null && (
              <button
                onClick={viewMode === "schools" ? cycleHomeSchool : scrollToHome}
                className={iconBtn}
                title={
                  viewMode === "schools"
                    ? "Step through the schools in my district"
                    : "Scroll to my district"
                }
              >
                <Icon name="myDistrictSchools" />
              </button>
            )}
            <button
              onClick={() => setViewDialog(true)}
              disabled={columns.length === 0}
              className={iconBtn}
              title="Save all filters, sorts & columns as a named view"
            >
              <Icon name="saveViewOrGroup" />
            </button>
            <button
              onClick={() => setConfirmClear(true)}
              disabled={columns.length === 0 && districtSort.length === 0 && schoolSort.length === 0 && hidden.size === 0 && !county && !groupFilter}
              className={iconBtn}
              title="Clear all columns, filters, and sorts"
            >
              <Icon name="clear" />
            </button>
            <IconMenu
              icon="export"
              title="Export data (PDF / Excel / CSV)"
              buttonClassName={iconBtn}
              disabled={columns.length === 0}
              items={[
                { label: "PDF", onClick: () => exportSheet("pdf") },
                { label: "Excel", onClick: () => exportSheet("excel") },
                { label: "CSV", onClick: () => exportSheet("csv") },
              ]}
            />
            <span className="ml-auto text-xs text-slate-400">
              {viewName ? <span className="mr-2 text-indigo-500">“{viewName}”</span> : null}
              {paneHidden &&
                `${rows.length.toLocaleString()} rows · ${columns.length} column${columns.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
              <span className="font-medium text-indigo-700 dark:text-indigo-300">
                {selected.size} selected
              </span>
              <button
                onClick={showOnlySelected}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500"
              >
                Show only these entities
              </button>
              <button
                onClick={() => setGroupDialog(true)}
                className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300"
              >
                Create group from these entities
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="ml-auto text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Clear selection
              </button>
            </div>
          )}

          <SheetDrop scrollRef={scrollRef}>
            {columns.length === 0 ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-400">
                Drag metrics here to build columns. Right-click a column or the name header to sort,
                edit, or collapse; drag headers to reorder, or use the ✕ to remove a column.
              </div>
            ) : (
              <table className="border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    {/* frozen left block: select-all · (rank) · name — one sticky
                        cell (no titles on the first two), so there are no seams */}
                    <th className="sticky left-0 top-0 z-30 border-b border-slate-200 bg-slate-100 p-0 dark:border-slate-800 dark:bg-slate-800">
                      <div className="flex items-stretch">
                        <div className="flex w-[40px] items-center justify-center py-2">
                          <input
                            type="checkbox"
                            title="Select all shown"
                            checked={rows.length > 0 && rows.every((r) => selected.has(r.entity.id))}
                            onChange={(ev) =>
                              setSelected((prev) => {
                                const n = new Set(prev);
                                for (const r of rows) {
                                  if (ev.target.checked) n.add(r.entity.id);
                                  else n.delete(r.entity.id);
                                }
                                return n;
                              })
                            }
                          />
                        </div>
                        <div className="w-[56px]" />
                        <div
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setCtx({ key: "name", kind: "name", x: e.clientX, y: e.clientY });
                          }}
                          className="min-w-[240px] flex-1 cursor-context-menu px-3 py-2 text-left"
                        >
                          School / District{" "}
                          {sortLabel("name") ? (
                            <span className="font-normal text-indigo-500">{sortLabel("name")}</span>
                          ) : nameSortsByDefault ? (
                            <span className="font-normal text-slate-400" title="Default sort: name A→Z">
                              A→Z
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </th>
                    {columns.map((col) => (
                      <ColumnHeader
                        key={col.id}
                        col={col}
                        sortLabel={sortLabel(col.id)}
                        onContext={(e, c) => {
                          e.preventDefault();
                          setCtx({
                            key: c.id,
                            kind: c.kind,
                            calcId: c.kind === "calc" ? c.id : undefined,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                        onRemove={removeColumn}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ entity: e, type, collapsible, rank }) => {
                    const isHomeDistrict = e.id === homeDistrictId;
                    // Highlight the home district and every school within it.
                    const isHome =
                      homeDistrictId != null &&
                      (isHomeDistrict || e.parentDistrictId === homeDistrictId);
                    const stickyBg = isHome
                      ? "bg-indigo-50 dark:bg-indigo-950/40"
                      : "bg-white dark:bg-slate-950";
                    return (
                      <tr key={e.id} data-eid={e.id} className={isHome ? "bg-indigo-50 dark:bg-indigo-950/40" : ""}>
                        <td className={`sticky left-0 z-20 border-b border-slate-100 p-0 dark:border-slate-800 ${stickyBg}`}>
                          <div className="flex items-stretch">
                            <div className="flex w-[40px] items-center justify-center py-1.5">
                              <input
                                type="checkbox"
                                checked={selected.has(e.id)}
                                onChange={() => toggleSelected(e.id)}
                              />
                            </div>
                            <div className="flex w-[56px] items-center justify-center py-1.5 text-xs tabular-nums text-slate-400">
                              {rank}
                            </div>
                            <div
                              className={`min-w-[240px] flex-1 px-3 py-1.5 ${type === "school" ? "pl-8" : ""}`}
                            >
                              {collapsible && (
                                <button
                                  onClick={() =>
                                    setCollapsed((prev) => {
                                      const n = new Set(prev);
                                      if (n.has(e.id)) n.delete(e.id);
                                      else n.add(e.id);
                                      return n;
                                    })
                                  }
                                  className="mr-1 text-slate-400 hover:text-slate-700"
                                >
                                  {collapsed.has(e.id) ? "▸" : "▾"}
                                </button>
                              )}
                              <span className={`${type === "district" ? "font-medium" : ""} text-slate-800 dark:text-slate-100`}>
                                {e.name}
                              </span>
                              {isHomeDistrict && <span className="ml-1 text-xs font-medium text-indigo-500">· home</span>}
                            </div>
                          </div>
                        </td>
                        {columns.map((col) => {
                          const v = getVal(col, e.id);
                          return (
                            <td
                              key={col.id}
                              className={`border-b border-l border-slate-100 px-3 py-1.5 text-right tabular-nums dark:border-slate-800 ${
                                isHome ? "" : ""
                              } text-slate-700 dark:text-slate-200`}
                            >
                              {loading.has(col.id)
                                ? "…"
                                : col.kind === "data"
                                  ? formatValue(v, col.metric.dataType, col.metric.unit)
                                  : formatCalc(col, v)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </SheetDrop>
        </section>

        {entityPanel && (
          <EntityPanel
            entities={entities.filter((e) =>
              viewMode === "districts" ? e.type === "district" : viewMode === "schools" ? e.type === "school" : true,
            )}
            county={county}
            hidden={hidden}
            setHidden={applyHidden}
            onClose={() => setEntityPanel(false)}
          />
        )}

        {ctx && (
          <SortMenu
            ctx={ctx}
            view={viewMode}
            canSubgroup={(() => {
              const col = columnsById[ctx.key];
              return col?.kind === "data" && demographicSet.has(col.metric.code);
            })()}
            applySort={applySort}
            clearSorts={clearSorts}
            onEdit={(id) => {
              setCalcDialog({ editId: id });
              setCtx(null);
            }}
            onSubgroup={() => {
              const col = columnsById[ctx.key];
              if (col?.kind === "data") setSubgroupCol(col);
              setCtx(null);
            }}
            collapseAll={() => {
              collapseAll();
              setCtx(null);
            }}
            expandAll={() => {
              expandAll();
              setCtx(null);
            }}
          />
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="rounded-lg border border-indigo-400 bg-white px-3 py-2 text-sm font-medium text-indigo-700 shadow-lg dark:bg-slate-900 dark:text-indigo-300">
            {dragging.label}
          </div>
        )}
      </DragOverlay>

    </DndContext>

      {calcDialog && (
        <CalcDialog
          sources={dataColumns.map((c) => ({
            id: c.id,
            label: `${c.metric.name} (${c.year})${
              c.subgroup !== ALL_STUDENTS ? ` · ${c.subgroup}` : ""
            }`,
          }))}
          entities={districtOptions}
          defaultRefId={homeDistrictId}
          onReorderSources={reorderSelected}
          initial={
            editingCalc
              ? {
                  calcType: editingCalc.calcType,
                  name: editingCalc.name,
                  sourceIds: editingCalc.sourceIds,
                  weights: editingCalc.weights,
                  asPercent: editingCalc.asPercent,
                  refEntityId: editingCalc.refEntityId ?? null,
                }
              : undefined
          }
          onConfirm={submitCalc}
          onClose={() => setCalcDialog(null)}
        />
      )}

      {groupDialog && (
        <GroupDialog
          count={selected.size}
          onCreate={handleCreateGroup}
          onClose={() => setGroupDialog(false)}
        />
      )}

      {viewDialog && (
        <NameDialog
          title="Save view"
          blurb="Save every filter, sort, and column (including calculated fields) as a named view you can reopen from the dashboard."
          initialName={viewName ?? ""}
          submitLabel="Save view"
          placeholder="e.g. Westchester grad-rate scan"
          onSubmit={handleSaveView}
          onClose={() => setViewDialog(false)}
        />
      )}

      {subgroupCol && (
        <SubgroupDialog
          column={subgroupCol}
          active={columns
            .filter(
              (c): c is DataColumn =>
                c.kind === "data" &&
                c.metric.code === subgroupCol.metric.code &&
                c.year === subgroupCol.year,
            )
            .map((c) => c.subgroup)}
          onApply={(subs) => {
            void applyColumnSubgroups(subgroupCol.id, subs);
            setSubgroupCol(null);
          }}
          onClose={() => setSubgroupCol(null)}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear the workshop?"
          body="This removes all columns, calculated fields, filters, and sorts and returns to a blank sheet. Saved views and groups are not affected."
          confirmLabel="Clear"
          onConfirm={clearWorkshop}
          onClose={() => setConfirmClear(false)}
        />
      )}

      {viewConflict && (
        <OverwriteDialog
          kind="view"
          name={viewConflict.name}
          onOverwrite={() => resolveViewConflict("overwrite")}
          onSaveNew={() => resolveViewConflict("new")}
          onClose={() => setViewConflict(null)}
        />
      )}
      {groupConflict && (
        <OverwriteDialog
          kind="group"
          name={groupConflict.name}
          onOverwrite={() => resolveGroupConflict("overwrite")}
          onSaveNew={() => resolveGroupConflict("new")}
          onClose={() => setGroupConflict(null)}
        />
      )}
    </>
  );
}

// ── overwrite-or-save-new prompt (name collision) ──
function OverwriteDialog({
  kind,
  name,
  onOverwrite,
  onSaveNew,
  onClose,
}: {
  kind: "view" | "group";
  name: string;
  onOverwrite: () => void;
  onSaveNew: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Name already used</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          A {kind} named “{name}” already exists. Overwrite it, or save this as a new {kind}?
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={onSaveNew}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Icon name="saveViewOrGroup" className="h-4 w-4" />
            Save as new
          </button>
          <button
            onClick={onOverwrite}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            <Icon name="saveViewOrGroup" className="h-4 w-4" />
            Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}

// ── confirm dialog ──
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{body}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
          >
            <Icon name="clear" className="h-4 w-4" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── turn demographic slices of a metric on/off (one column each) ──
function SubgroupDialog({
  column,
  active,
  onApply,
  onClose,
}: {
  column: DataColumn;
  active: string[]; // subgroups of this metric/year that currently have a column
  onApply: (subgroups: string[]) => void;
  onClose: () => void;
}) {
  const [subgroups, setSubgroups] = useState<string[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set(active));

  useEffect(() => {
    let live = true;
    getMetricSubgroups(column.metric.code, column.year).then((s) => {
      if (live) setSubgroups(s);
    });
    return () => {
      live = false;
    };
  }, [column.metric.code, column.year]);

  const toggle = (sg: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(sg)) n.delete(sg);
      else n.add(sg);
      return n;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Demographics</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Turn demographic slices of <span className="font-medium">{column.metric.name}</span> (
          {column.year}) on or off — each checked group becomes its own column. Only groups with
          data for this metric are listed.
        </p>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {subgroups === null ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : subgroups.length <= 1 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              This metric isn&apos;t broken down by demographics — only “All Students” is available.
            </p>
          ) : (
            <div className="space-y-0.5">
              {subgroups.map((sg) => (
                <label
                  key={sg}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <input type="checkbox" checked={checked.has(sg)} onChange={() => toggle(sg)} />
                  <span className="text-slate-700 dark:text-slate-200">{sg}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {subgroups && subgroups.length > 1 && (
          <p className="mt-2 text-xs text-slate-400">
            These are separate breakdowns, not a combined filter — the source reports one at a time,
            so an intersection like “Hispanic &amp; non-poverty” isn&apos;t available.
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={() => onApply([...checked])}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ── create-group dialog ──
function GroupDialog({
  count,
  onCreate,
  onClose,
}: {
  count: number;
  onCreate: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  return (
    <NameDialog
      title="Create group"
      blurb={`Save ${count} selected ${count === 1 ? "entity" : "entities"} as a reusable group.`}
      initialName=""
      submitLabel="Create group"
      placeholder="e.g. My comparison set"
      onSubmit={onCreate}
      onClose={onClose}
    />
  );
}

// ── generic name-prompt dialog (create group / save view) ──
function NameDialog({
  title,
  blurb,
  initialName,
  submitLabel,
  placeholder,
  onSubmit,
  onClose,
}: {
  title: string;
  blurb: string;
  initialName: string;
  submitLabel: string;
  placeholder?: string;
  onSubmit: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await onSubmit(name.trim());
    setSaving(false);
    if (!res.ok) setError(res.error ?? "Something went wrong.");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{blurb}</p>
        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !saving) submit();
            }}
            placeholder={placeholder}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim() || saving}
            onClick={submit}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            <Icon name="saveViewOrGroup" className="h-4 w-4" />
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── sort context menu ──
function SortMenu({
  ctx,
  view,
  canSubgroup,
  applySort,
  clearSorts,
  onEdit,
  onSubgroup,
  collapseAll,
  expandAll,
}: {
  ctx: Ctx;
  view: ViewMode;
  canSubgroup: boolean;
  applySort: (level: "district" | "school", key: string, dir: "asc" | "desc", add: boolean) => void;
  clearSorts: () => void;
  onEdit: (id: string) => void;
  onSubgroup: () => void;
  collapseAll: () => void;
  expandAll: () => void;
}) {
  const Item = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button onClick={onClick} className="block w-full px-3 py-1 text-left hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
      {children}
    </button>
  );
  const Hdr = ({ children }: { children: React.ReactNode }) => (
    <p className="px-3 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</p>
  );
  const level = (l: "district" | "school", label: string) => (
    <>
      <Hdr>{label}</Hdr>
      <Item onClick={() => applySort(l, ctx.key, "asc", false)}>Sort ascending ▲</Item>
      <Item onClick={() => applySort(l, ctx.key, "desc", false)}>Sort descending ▼</Item>
      <Item onClick={() => applySort(l, ctx.key, "asc", true)}>Add to sort ▲</Item>
      <Item onClick={() => applySort(l, ctx.key, "desc", true)}>Add to sort ▼</Item>
    </>
  );

  return (
    <div className="fixed z-50 w-52 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900" style={{ top: ctx.y, left: ctx.x }}>
      {ctx.kind === "calc" && ctx.calcId && (
        <>
          <Item onClick={() => onEdit(ctx.calcId!)}>Edit calculated field…</Item>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
        </>
      )}
      {ctx.kind === "data" && canSubgroup && (
        <>
          <Item onClick={onSubgroup}>Choose demographic…</Item>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
        </>
      )}
      {view === "both" ? (
        <>
          {level("district", "Districts")}
          {level("school", "Schools")}
        </>
      ) : (
        level("district", "Sort")
      )}
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      {ctx.kind === "name" && view === "both" && (
        <>
          <Item onClick={collapseAll}>Collapse all</Item>
          <Item onClick={expandAll}>Expand all</Item>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
        </>
      )}
      <Item onClick={clearSorts}>Clear sorts</Item>
    </div>
  );
}

function EntityPanel({
  entities,
  county,
  hidden,
  setHidden,
  onClose,
}: {
  entities: WorkshopEntity[];
  county: string;
  hidden: Set<number>;
  setHidden: (s: Set<number>) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const list = entities.filter(
    (e) =>
      (!county || e.county === county) &&
      (!needle || e.name.toLowerCase().includes(needle)),
  );
  const toggle = (id: number) => {
    const n = new Set(hidden);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setHidden(n);
  };
  // Show/hide "all" act on what's currently listed (respecting search + county).
  const setForList = (hide: boolean) => {
    const n = new Set(hidden);
    for (const e of list) {
      if (hide) n.add(e.id);
      else n.delete(e.id);
    }
    setHidden(n);
  };
  return (
    <div className="fixed right-4 top-24 z-40 flex max-h-[70vh] w-72 flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Show / hide entities</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
      </div>
      <div className="border-b border-slate-100 p-2 dark:border-slate-800">
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      </div>
      <div className="flex gap-2 border-b border-slate-100 px-3 py-1.5 text-xs dark:border-slate-800">
        <button onClick={() => setForList(false)} className="text-indigo-600 hover:underline">Show all</button>
        <button onClick={() => setForList(true)} className="text-indigo-600 hover:underline">Hide all</button>
        <span className="ml-auto text-slate-400">{list.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {list.map((e) => (
          <label key={e.id} className="flex items-center gap-2 px-1 py-0.5 text-sm">
            <input type="checkbox" checked={!hidden.has(e.id)} onChange={() => toggle(e.id)} />
            <span className="truncate text-slate-700 dark:text-slate-200">{e.name}</span>
          </label>
        ))}
        {list.length === 0 && <p className="px-1 py-2 text-sm text-slate-400">No matches.</p>}
      </div>
    </div>
  );
}
