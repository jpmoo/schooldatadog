"use server";

import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, facts, metrics } from "@/db/schema";
import { requireUser } from "@/lib/auth/guards";
import { embedTexts } from "@/lib/ollama/embed";
import { getOllamaConfig } from "@/lib/settings";
import type { CellValue, MetricLite } from "./types";

const RESULT_LIMIT = 60;

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Find metrics by keyword AND semantic similarity. With no query, returns the
 * whole catalog (by category) for browsing. With a query, blends a keyword
 * score with cosine similarity of the query embedding (when Ollama is set up).
 */
export async function searchMetrics(query: string): Promise<MetricLite[]> {
  await requireUser();
  const q = query.trim();

  if (!q) {
    const rows = await db
      .select({
        id: metrics.id, code: metrics.code, name: metrics.name,
        category: metrics.category, unit: metrics.unit, dataType: metrics.dataType,
      })
      .from(metrics)
      .orderBy(asc(metrics.category), asc(metrics.name));
    return rows;
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

  const scored = rows.map((m) => {
    const hay = `${m.name} ${m.code} ${m.description ?? ""} ${m.category ?? ""}`.toLowerCase();
    const hits = tokens.filter((t) => hay.includes(t)).length;
    const keyword = tokens.length ? hits / tokens.length : 0;
    const semantic = queryVec && m.embedding ? cosine(queryVec, m.embedding) : 0;
    // Blend; a full keyword match alone is enough to surface a metric.
    const score = queryVec ? 0.55 * semantic + 0.45 * keyword : keyword;
    return { m, score, keyword, semantic };
  });

  return scored
    .filter((s) => s.keyword > 0 || s.semantic >= 0.45)
    .sort((a, b) => b.score - a.score)
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
