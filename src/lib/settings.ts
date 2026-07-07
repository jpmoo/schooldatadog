import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

/** Well-known setting keys. */
export const SETTINGS = {
  ollamaBaseUrl: "ollama_base_url",
  /** Main model for chat / grouping / prompting. */
  ollamaModel: "ollama_model",
  /** Model used to generate embeddings for semantic search. */
  ollamaEmbeddingModel: "ollama_embedding_model",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string,
  updatedByUserId?: number,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedByUserId: updatedByUserId ?? null })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value,
        updatedAt: new Date(),
        updatedByUserId: updatedByUserId ?? null,
      },
    });
}

export type OllamaConfig = {
  baseUrl: string | null;
  model: string | null;
  embeddingModel: string | null;
};

export async function getOllamaConfig(): Promise<OllamaConfig> {
  const [baseUrl, model, embeddingModel] = await Promise.all([
    getSetting(SETTINGS.ollamaBaseUrl),
    getSetting(SETTINGS.ollamaModel),
    getSetting(SETTINGS.ollamaEmbeddingModel),
  ]);
  return { baseUrl, model, embeddingModel };
}
