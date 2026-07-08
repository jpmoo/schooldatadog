import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_BACKUP_CONFIG, type BackupConfig } from "@/lib/backup/config";

/** Well-known setting keys. */
export const SETTINGS = {
  ollamaBaseUrl: "ollama_base_url",
  /** Main model for chat / grouping / prompting. */
  ollamaModel: "ollama_model",
  /** Model used to generate embeddings for semantic search. */
  ollamaEmbeddingModel: "ollama_embedding_model",
  /** IANA timezone used to display timestamps (e.g. the activity log). */
  timezone: "timezone",
  /** Automated database backups (see @/lib/backup). */
  backupEnabled: "backup_enabled",
  backupFrequency: "backup_frequency",
  backupHour: "backup_hour",
  backupMinute: "backup_minute",
  backupWeekday: "backup_weekday",
  backupRetention: "backup_retention",
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

/** The configured display timezone, defaulting to Eastern (NY). */
export async function getTimezone(): Promise<string> {
  return (await getSetting(SETTINGS.timezone)) || "America/New_York";
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

/** Read the automated-backup schedule from settings, filling defaults. */
export async function getBackupConfig(): Promise<BackupConfig> {
  const [enabled, frequency, hour, minute, weekday, retention] = await Promise.all([
    getSetting(SETTINGS.backupEnabled),
    getSetting(SETTINGS.backupFrequency),
    getSetting(SETTINGS.backupHour),
    getSetting(SETTINGS.backupMinute),
    getSetting(SETTINGS.backupWeekday),
    getSetting(SETTINGS.backupRetention),
  ]);
  const d = DEFAULT_BACKUP_CONFIG;
  const int = (v: string | null, fallback: number, min: number, max: number) => {
    const n = v == null ? NaN : Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    enabled: enabled === "1",
    frequency: frequency === "weekly" ? "weekly" : "daily",
    hour: int(hour, d.hour, 0, 23),
    minute: int(minute, d.minute, 0, 59),
    weekday: int(weekday, d.weekday, 0, 6),
    retention: int(retention, d.retention, 1, 365),
  };
}
