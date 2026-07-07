import { createHash } from "node:crypto";

export type EmbeddableMetric = {
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
};

/**
 * The exact text embedded for a metric. Shared by the batch embed script and
 * the on-edit re-embed so their hashes stay consistent (a mismatch would cause
 * spurious re-embeds).
 */
export function buildMetricEmbedInput(m: EmbeddableMetric): string {
  const head = m.description ? `${m.name}. ${m.description}` : m.name;
  const meta = [
    m.category ? `Category: ${m.category}` : null,
    m.unit ? `Unit: ${m.unit}` : null,
    `Code: ${m.code}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${head}\n${meta}`;
}

export function metricEmbedHash(model: string, input: string): string {
  return createHash("sha256").update(`${model}\n${input}`).digest("hex");
}
