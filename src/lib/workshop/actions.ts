"use server";

import { and, asc, eq, exists, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, facts, metrics } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { embedTexts } from "@/lib/ollama/embed";
import { getOllamaConfig } from "@/lib/settings";
import type { CellValue, MetricLite } from "./types";

const RESULT_LIMIT = 60;
// Only genuinely-close semantic neighbours ride along after the keyword hits.
const SEMANTIC_MIN = 0.8;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Literal-match relevance: exact name > name substring > category/code > tokens. */
function keywordScore(
  m: { name: string; code: string; category: string | null; description: string | null },
  ql: string,
  tokens: string[],
): number {
  const name = m.name.toLowerCase();
  const code = m.code.toLowerCase();
  const cat = (m.category ?? "").toLowerCase();
  const desc = (m.description ?? "").toLowerCase();
  if (name === ql) return 1000;
  let s = 0;
  if (name.includes(ql)) s += 100; // the whole query appears in the name
  if (cat.includes(ql)) s += 40;
  if (code.includes(ql) || code.includes(ql.replace(/\s+/g, "_"))) s += 30;
  if (desc.includes(ql)) s += 10;
  for (const t of tokens) {
    if (name.includes(t)) s += 8;
    else if (cat.includes(t)) s += 4;
    else if (code.includes(t)) s += 3;
    else if (desc.includes(t)) s += 1;
  }
  return s;
}

/** Ids of metrics that actually have a value for `year` (subgroup All Students). */
async function metricIdsWithData(year: string): Promise<Set<number>> {
  const rows = await db
    .select({ id: metrics.id })
    .from(metrics)
    .where(
      exists(
        db
          .select({ x: sql`1` })
          .from(facts)
          .where(
            and(
              eq(facts.metricId, metrics.id),
              eq(facts.schoolYear, year),
              eq(facts.subgroup, "All Students"),
              or(isNotNull(facts.valueNumeric), isNotNull(facts.valueText)),
            ),
          ),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Find metrics by keyword and semantic similarity. With no query, returns the
 * catalog (by category) for browsing. Results are ordered strictly: every
 * keyword match first (by literal relevance), then semantic neighbours scoring
 * ≥ 0.8 that weren't already matched. When `year` is given, only metrics with
 * data for that year are considered — so e.g. AP/IB/ELL vanish in a year that
 * lacks them.
 */
export async function searchMetrics(query: string, year?: string): Promise<MetricLite[]> {
  await requireUser();
  const q = query.trim();

  const allowed = year ? await metricIdsWithData(year) : null;
  const keep = (id: number) => !allowed || allowed.has(id);

  if (!q) {
    const rows = await db
      .select({
        id: metrics.id, code: metrics.code, name: metrics.name,
        category: metrics.category, unit: metrics.unit, dataType: metrics.dataType,
      })
      .from(metrics)
      .orderBy(asc(metrics.category), asc(metrics.name));
    return rows.filter((m) => keep(m.id));
  }

  // Try a semantic embedding of the query (best-effort).
  let queryVec: number[] | null = null;
  try {
    const { baseUrl, embeddingModel } = await getOllamaConfig();
    if (baseUrl && embeddingModel) {
      [queryVec] = await embedTexts(baseUrl, embeddingModel, [q], 15_000);
    }
  } catch {
    queryVec = null;
  }

  const rows = await db
    .select({
      id: metrics.id, code: metrics.code, name: metrics.name,
      category: metrics.category, unit: metrics.unit, dataType: metrics.dataType,
      description: metrics.description, embedding: metrics.embedding,
    })
    .from(metrics);

  const ql = q.toLowerCase();
  const tokens = ql.split(/\s+/).filter(Boolean);

  const scored = rows
    .filter((m) => keep(m.id))
    .map((m) => ({
      m,
      keyword: keywordScore(m, ql, tokens),
      semantic: queryVec && m.embedding ? cosine(queryVec, m.embedding) : 0,
    }));

  // Tier 1: literal keyword matches, most-relevant first.
  const keywordHits = scored
    .filter((s) => s.keyword > 0)
    .sort(
      (a, b) => b.keyword - a.keyword || b.semantic - a.semantic || a.m.name.localeCompare(b.m.name),
    );

  // Tier 2: strong semantic neighbours that weren't keyword matches.
  const semanticHits = scored
    .filter((s) => s.keyword === 0 && s.semantic >= SEMANTIC_MIN)
    .sort((a, b) => b.semantic - a.semantic);

  return [...keywordHits, ...semanticHits]
    .slice(0, RESULT_LIMIT)
    .map(({ m }) => ({
      id: m.id, code: m.code, name: m.name,
      category: m.category, unit: m.unit, dataType: m.dataType,
    }));
}

/**
 * Values for one metric/year column across all entities (subgroup "All
 * Students"). The client keys these by entity id and filters/pivots locally.
 */
export async function getColumnValues(
  metricCode: string,
  year: string,
): Promise<CellValue[]> {
  await requireUser();
  const rows = await db
    .select({ entityId: facts.entityId, value: facts.valueNumeric })
    .from(facts)
    .innerJoin(metrics, eq(metrics.id, facts.metricId))
    .innerJoin(entities, eq(entities.id, facts.entityId))
    .where(
      and(
        eq(metrics.code, metricCode),
        eq(facts.schoolYear, year),
        eq(facts.subgroup, "All Students"),
      ),
    );
  return rows.map((r) => ({ entityId: r.entityId, value: r.value }));
}
