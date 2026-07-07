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
import { getColumnValues, searchMetrics } from "@/lib/workshop/actions";
import type { MetricLite } from "@/lib/workshop/types";
import type { WorkshopEntity } from "@/lib/workshop/queries";
import { CalcDialog, type CalcConfig } from "./calc-dialog";
import {
  computeCalc,
  formatValue,
  type CalcColumn,
  type Column,
  type DataColumn,
  type SortDir,
} from "./columns";

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
      className="cursor-grab rounded-lg border border-dashed border-indigo-400 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 active:cursor-grabbing dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
    >
      + Calculated Field <span className="text-xs font-normal">(drag onto the sheet)</span>
    </div>
  );
}

function ColumnHeader({
  col,
  onContext,
  onRemove,
}: {
  col: Column;
  onContext: (e: React.MouseEvent, colId: string) => void;
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
  const arrow = col.sort === "asc" ? " ▲" : col.sort === "desc" ? " ▼" : "";

  return (
    <th
      ref={setRef}
      onContextMenu={(e) => onContext(e, col.id)}
      className={`sticky top-0 z-10 min-w-[140px] cursor-grab border-b border-l border-slate-200 bg-slate-50 px-3 py-2 text-left align-top dark:border-slate-800 dark:bg-slate-900 ${
        drop.isOver ? "bg-indigo-100 dark:bg-indigo-950" : ""
      } ${drag.isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span {...drag.listeners} {...drag.attributes} className="flex-1">
          <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">
            {title}
            {arrow}
          </span>
          <span className="block text-[11px] font-normal text-slate-400">
            {col.kind === "calc" ? "ƒ " : ""}
            {sub}
          </span>
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

function RemoveZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "remove" });
  if (!active) return null;
  return (
    <div
      ref={setNodeRef}
      className={`flex h-9 items-center justify-center rounded-lg border-2 border-dashed text-xs font-medium ${
        isOver
          ? "border-red-500 bg-red-50 text-red-600 dark:bg-red-950/40"
          : "border-slate-300 text-slate-400 dark:border-slate-700"
      }`}
    >
      Drop here to remove column
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────

export function Workshop({
  years,
  counties,
  entities,
  initialMetrics,
}: {
  years: string[];
  counties: string[];
  entities: WorkshopEntity[];
  initialMetrics: MetricLite[];
}) {
  const [year, setYear] = useState(years[0] ?? "");
  const [query, setQuery] = useState("");
  const [metrics, setMetrics] = useState<MetricLite[]>(initialMetrics);
  const [isSearching, startSearch] = useTransition();

  const [viewMode, setViewMode] = useState<"districts" | "both">("districts");
  const [county, setCounty] = useState("");
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [entityPanel, setEntityPanel] = useState(false);

  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [calcOpen, setCalcOpen] = useState(false);
  const [ctx, setCtx] = useState<{ colId: string; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<{ kind: string; label: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Render the drag-and-drop tree only after mount so dnd-kit's generated
  // accessibility ids don't cause a server/client hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      startSearch(async () => setMetrics(await searchMetrics(query)));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // ── derived ──
  const visibleEntities = useMemo(
    () =>
      entities.filter((e) => {
        if (viewMode === "districts" && e.type !== "district") return false;
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

  const sortCol = columns.find((c) => c.sort) ?? null;
  const rows = useMemo(() => {
    const arr = [...visibleEntities];
    if (sortCol) {
      const dir = sortCol.sort === "asc" ? 1 : -1;
      arr.sort((a, b) => {
        const va = getVal(sortCol, a.id);
        const vb = getVal(sortCol, b.id);
        if (va === null && vb === null) return a.name.localeCompare(b.name);
        if (va === null) return 1;
        if (vb === null) return -1;
        return (va - vb) * dir;
      });
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEntities, sortCol, calcValues, columns]);

  // ── column ops ──
  async function addDataColumn(metric: MetricLite, yr: string) {
    if (columns.some((c) => c.kind === "data" && c.metric.code === metric.code && c.year === yr))
      return; // no duplicate datapoint
    const id = `data-${metric.code}-${yr}-${columns.length}-${Math.round(performance.now())}`;
    const col: DataColumn = { id, kind: "data", metric, year: yr, values: {}, sort: null };
    setColumns((cs) => [...cs, col]);
    setLoading((s) => new Set(s).add(id));
    const vals = await getColumnValues(metric.code, yr);
    const map: Record<number, number | null> = {};
    for (const v of vals) map[v.entityId] = v.value;
    setColumns((cs) => cs.map((c) => (c.id === id ? { ...(c as DataColumn), values: map } : c)));
    setLoading((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  }

  function addCalcColumn(config: CalcConfig) {
    const id = `calc-${columns.length}-${Math.round(performance.now())}`;
    const col: CalcColumn = {
      id,
      kind: "calc",
      calcType: config.calcType,
      name: config.name,
      sourceIds: config.sourceIds,
      weights: config.weights,
      sort: null,
    };
    setColumns((cs) => [...cs, col]);
    setCalcOpen(false);
  }

  const removeColumn = (id: string) =>
    setColumns((cs) =>
      cs
        .filter((c) => c.id !== id)
        // also drop the removed column from any calc field's sources
        .map((c) =>
          c.kind === "calc"
            ? { ...c, sourceIds: c.sourceIds.filter((s) => s !== id) }
            : c,
        ),
    );
  const setSort = (id: string, dir: SortDir | null) =>
    setColumns((cs) => cs.map((c) => ({ ...c, sort: c.id === id ? dir : null })));

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

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    if (id.startsWith("metric:")) {
      const m = e.active.data.current?.metric as MetricLite | undefined;
      setDragging({ kind: "metric", label: m?.name ?? "metric" });
    } else if (id === "calc-source") setDragging({ kind: "calc", label: "Calculated Field" });
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
      if (o !== "remove") {
        const m = active.data.current?.metric as MetricLite | undefined;
        if (m) void addDataColumn(m, year);
      }
    } else if (a === "calc-source") {
      if (o !== "remove") setCalcOpen(true);
    } else if (a.startsWith("col:")) {
      const colId = a.slice(4);
      if (o === "remove") removeColumn(colId);
      else if (o.startsWith("drop-")) reorder(colId, o.slice(5));
    }
  }

  const dataColumns = columns.filter((c): c is DataColumn => c.kind === "data");
  const grouped = useMemo(() => {
    if (query.trim()) return null; // flat ranked list when searching
    const map = new Map<string, MetricLite[]>();
    for (const m of metrics) {
      const k = m.category ?? "Other";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return [...map.entries()];
  }, [metrics, query]);

  if (!mounted) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center text-sm text-slate-400">
        Loading the workshop…
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        className="flex h-[calc(100vh-8rem)] gap-3"
        onClick={() => ctx && setCtx(null)}
      >
        {/* LEFT 30% — metrics */}
        <aside className="flex w-[30%] min-w-[260px] flex-col gap-3 overflow-hidden">
          <CalcSource />
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Year</label>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
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
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {isSearching && <p className="text-xs text-slate-400">Searching…</p>}
            {grouped
              ? grouped.map(([cat, list]) => (
                  <div key={cat}>
                    <p className="sticky top-0 bg-slate-50 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:bg-slate-950">
                      {cat}
                    </p>
                    <div className="space-y-1.5">
                      {list.map((m) => (
                        <MetricChip key={m.code} metric={m} />
                      ))}
                    </div>
                  </div>
                ))
              : metrics.map((m) => <MetricChip key={m.code} metric={m} />)}
            {metrics.length === 0 && !isSearching && (
              <p className="text-sm text-slate-400">No metrics match.</p>
            )}
          </div>
        </aside>

        {/* RIGHT 70% — sheet */}
        <section className="flex flex-1 flex-col gap-2 overflow-hidden">
          {/* filters */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm dark:border-slate-800 dark:bg-slate-900">
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as "districts" | "both")}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="districts">Districts only</option>
              <option value="both">Districts &amp; schools</option>
            </select>
            <select
              value={county}
              onChange={(e) => setCounty(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">All counties</option>
              {counties.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              onClick={() => setEntityPanel((v) => !v)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 dark:border-slate-700 dark:text-slate-200"
            >
              Entities ({hidden.size > 0 ? `${hidden.size} hidden` : "all shown"})
            </button>
            <select
              disabled
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-400 dark:border-slate-800"
              title="Saved groups (coming soon)"
            >
              <option>Saved groups…</option>
            </select>
            <span className="ml-auto text-xs text-slate-400">
              {rows.length.toLocaleString()} rows · {columns.length} column
              {columns.length === 1 ? "" : "s"}
            </span>
          </div>

          <RemoveZone active={dragging?.kind === "col"} />

          {/* grid */}
          <SheetDrop>
            {columns.length === 0 ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-slate-400">
                Drag metrics here to build columns. Right-click a column header to sort;
                drag headers to reorder or onto the remove bar to delete.
              </div>
            ) : (
              <table className="border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-20 min-w-[220px] border-b border-slate-200 bg-slate-100 px-3 py-2 text-left dark:border-slate-800 dark:bg-slate-800">
                      School / District
                    </th>
                    {columns.map((col) => (
                      <ColumnHeader
                        key={col.id}
                        col={col}
                        onContext={(e, id) => {
                          e.preventDefault();
                          setCtx({ colId: id, x: e.clientX, y: e.clientY });
                        }}
                        onRemove={removeColumn}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="group">
                      <td className="sticky left-0 z-10 min-w-[220px] border-b border-slate-100 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950">
                        <span className="text-slate-800 dark:text-slate-100">{e.name}</span>
                        <span className="ml-1 text-xs text-slate-400">
                          {e.type === "school" ? "· school" : ""}
                        </span>
                      </td>
                      {columns.map((col) => {
                        const v = getVal(col, e.id);
                        const dt = col.kind === "data" ? col.metric.dataType : undefined;
                        const unit = col.kind === "data" ? col.metric.unit : "%";
                        return (
                          <td
                            key={col.id}
                            className="border-b border-l border-slate-100 px-3 py-1.5 text-right tabular-nums text-slate-700 dark:border-slate-800 dark:text-slate-200"
                          >
                            {loading.has(col.id) ? (
                              <span className="text-slate-300">…</span>
                            ) : (
                              formatValue(v, dt, unit)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SheetDrop>
        </section>

        {/* entity on/off panel */}
        {entityPanel && (
          <EntityPanel
            entities={entities.filter(
              (e) => viewMode === "both" || e.type === "district",
            )}
            county={county}
            hidden={hidden}
            setHidden={setHidden}
            onClose={() => setEntityPanel(false)}
          />
        )}

        {/* context menu */}
        {ctx && (
          <div
            className="fixed z-50 w-40 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900"
            style={{ top: ctx.y, left: ctx.x }}
          >
            {(["asc", "desc"] as SortDir[]).map((d) => (
              <button
                key={d}
                onClick={() => {
                  setSort(ctx.colId, d);
                  setCtx(null);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Sort {d === "asc" ? "ascending ▲" : "descending ▼"}
              </button>
            ))}
            <button
              onClick={() => {
                setSort(ctx.colId, null);
                setCtx(null);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Clear sort
            </button>
          </div>
        )}
      </div>

      <DragOverlay>
        {dragging && (
          <div className="rounded-lg border border-indigo-400 bg-white px-3 py-2 text-sm font-medium text-indigo-700 shadow-lg dark:bg-slate-900 dark:text-indigo-300">
            {dragging.label}
          </div>
        )}
      </DragOverlay>

      {calcOpen && (
        <CalcDialog
          sources={dataColumns.map((c) => ({
            id: c.id,
            label: `${c.metric.name} (${c.year})`,
          }))}
          onConfirm={addCalcColumn}
          onClose={() => setCalcOpen(false)}
        />
      )}
    </DndContext>
  );
}

function SheetDrop({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "sheet" });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-0 flex-1 overflow-auto rounded-lg border ${
        isOver ? "border-indigo-400" : "border-slate-200 dark:border-slate-800"
      }`}
    >
      {children}
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
  const list = entities.filter((e) => !county || e.county === county);
  const toggle = (id: number) => {
    const n = new Set(hidden);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setHidden(n);
  };
  return (
    <div className="fixed right-4 top-24 z-40 flex max-h-[70vh] w-72 flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Show / hide entities
        </span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
          ✕
        </button>
      </div>
      <div className="flex gap-2 border-b border-slate-100 px-3 py-1.5 text-xs dark:border-slate-800">
        <button onClick={() => setHidden(new Set())} className="text-indigo-600 hover:underline">
          Show all
        </button>
        <button
          onClick={() => setHidden(new Set(list.map((e) => e.id)))}
          className="text-indigo-600 hover:underline"
        >
          Hide all
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {list.map((e) => (
          <label key={e.id} className="flex items-center gap-2 px-1 py-0.5 text-sm">
            <input type="checkbox" checked={!hidden.has(e.id)} onChange={() => toggle(e.id)} />
            <span className="truncate text-slate-700 dark:text-slate-200">{e.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
