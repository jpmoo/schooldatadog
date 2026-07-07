import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { metrics } from "@/db/schema";
import { embedTexts } from "@/lib/ollama/embed";
import {
  buildMetricEmbedInput,
  metricEmbedHash,
} from "@/lib/ollama/metric-embedding";
import { getOllamaConfig } from "@/lib/settings";

/**
 * (Re)embed a single metric with the admin-configured Ollama embedding model.
 * Best-effort: a no-op if Ollama/embedding model isn't configured, and never
 * throws — a failure (Ollama down, etc.) just leaves the embedding for the next
 * `npm run embed:metrics` run to fix. Intended to run via `after()` so it never
 * blocks the edit.
 */
export async function reembedMetric(metricId: number): Promise<void> {
  try {
    const { baseUrl, embeddingModel } = await getOllamaConfig();
    if (!baseUrl || !embeddingModel) return;

    const [m] = await db
      .select({
        code: metrics.code,
        name: metrics.name,
        description: metrics.description,
        category: metrics.category,
        unit: metrics.unit,
      })
      .from(metrics)
      .where(eq(metrics.id, metricId))
      .limit(1);
    if (!m) return;

    const input = buildMetricEmbedInput(m);
    const [vector] = await embedTexts(baseUrl, embeddingModel, [input], 20_000);
    await db
      .update(metrics)
      .set({
        embedding: vector,
        embeddingModel,
        embeddingHash: metricEmbedHash(embeddingModel, input),
      })
      .where(eq(metrics.id, metricId));
  } catch (err) {
    console.error(`reembedMetric(${metricId}) failed:`, err);
  }
}
