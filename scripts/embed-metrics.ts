/**
 * Generate semantic-search embeddings for the metrics catalog.
 *
 * Incremental: only (re)embeds a metric when its embedding is missing, or when
 * the embedding model or the embedded text has changed (tracked via
 * metrics.embedding_model and metrics.embedding_hash). Safe to re-run.
 *
 * Ollama connection + embedding model are read from the `settings` table (as
 * configured in the admin UI), or overridden with --base-url / --model.
 *
 *   npm run embed:metrics -- [--dry-run] [--base-url http://host:11434] [--model nomic-embed-text]
 *
 * Only DATABASE_URL (from .env) and a reachable Ollama server are required.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { metrics, settings } from "../src/db/schema";
import { embedTexts } from "../src/lib/ollama/embed";

const SETTING_BASE_URL = "ollama_base_url";
const SETTING_EMBEDDING_MODEL = "ollama_embedding_model";
const BATCH_SIZE = 64;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DRY_RUN = process.argv.includes("--dry-run");

type MetricRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddingHash: string | null;
};

/** The text we embed for a metric — name + description + light metadata. */
function embedInput(m: MetricRow): string {
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

function hashOf(model: string, input: string): string {
  return createHash("sha256").update(`${model}\n${input}`).digest("hex");
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set (add it to .env).");

  const client = postgres(dbUrl, { max: 4 });
  const db = drizzle(client, { schema: { metrics, settings } });

  try {
    const getSetting = async (key: string): Promise<string | null> => {
      const [row] = await db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1);
      return row?.value ?? null;
    };

    const baseUrl = arg("base-url") ?? (await getSetting(SETTING_BASE_URL));
    const model = arg("model") ?? (await getSetting(SETTING_EMBEDDING_MODEL));

    if (!baseUrl || !model) {
      throw new Error(
        "No Ollama base URL / embedding model. Configure them in the admin AI settings, " +
          "or pass --base-url and --model.",
      );
    }

    const rows = (await db
      .select({
        id: metrics.id,
        code: metrics.code,
        name: metrics.name,
        description: metrics.description,
        category: metrics.category,
        unit: metrics.unit,
        embedding: metrics.embedding,
        embeddingModel: metrics.embeddingModel,
        embeddingHash: metrics.embeddingHash,
      })
      .from(metrics)) as MetricRow[];

    const todo = rows
      .map((m) => {
        const input = embedInput(m);
        return { m, input, hash: hashOf(model, input) };
      })
      .filter(
        ({ m, hash }) =>
          !m.embedding || m.embeddingModel !== model || m.embeddingHash !== hash,
      );

    console.log(
      `${rows.length} metrics total · ${todo.length} need embedding ` +
        `(model=${model}, server=${baseUrl})`,
    );

    if (DRY_RUN) {
      for (const { m } of todo.slice(0, 15)) console.log(`  • ${m.code} — ${m.name}`);
      if (todo.length > 15) console.log(`  … and ${todo.length - 15} more`);
      return;
    }
    if (todo.length === 0) {
      console.log("Nothing to embed. ✅");
      return;
    }

    let done = 0;
    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
      const batch = todo.slice(i, i + BATCH_SIZE);
      const vectors = await embedTexts(
        baseUrl,
        model,
        batch.map((b) => b.input),
      );
      for (let j = 0; j < batch.length; j++) {
        await db
          .update(metrics)
          .set({
            embedding: vectors[j],
            embeddingModel: model,
            embeddingHash: batch[j].hash,
          })
          .where(eq(metrics.id, batch[j].m.id));
      }
      done += batch.length;
      process.stdout.write(`\r  embedded ${done}/${todo.length}…`);
    }
    process.stdout.write("\n");
    console.log(`Done — ${done} metric(s) embedded with ${model}. ✅`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("embed-metrics failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
