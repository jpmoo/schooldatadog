"use server";

import { getCurrentSession } from "@/lib/auth/session";
import { getOllamaConfig, setSetting, SETTINGS } from "@/lib/settings";
import {
  listOllamaModels,
  normalizeBaseUrl,
  OllamaError,
  type OllamaModel,
} from "./client";

export type ProbeResult =
  | { ok: true; baseUrl: string; models: OllamaModel[] }
  | { ok: false; error: string };

async function requireAdminId(): Promise<number | null> {
  const { user } = await getCurrentSession();
  return user?.role === "admin" ? user.id : null;
}

function messageOf(err: unknown): string {
  return err instanceof OllamaError
    ? err.message
    : "Something went wrong talking to Ollama.";
}

/**
 * Validate + save the admin-entered Ollama address, then list its models.
 * The URL is only persisted once we've confirmed we can reach it.
 */
export async function connectOllama(rawUrl: string): Promise<ProbeResult> {
  const adminId = await requireAdminId();
  if (adminId === null) return { ok: false, error: "Not authorized." };

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(rawUrl);
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }

  try {
    const models = await listOllamaModels(baseUrl);
    await setSetting(SETTINGS.ollamaBaseUrl, baseUrl, adminId);
    return { ok: true, baseUrl, models };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

/** Re-list models from the already-saved Ollama address. */
export async function refreshOllamaModels(): Promise<ProbeResult> {
  const adminId = await requireAdminId();
  if (adminId === null) return { ok: false, error: "Not authorized." };

  const { baseUrl } = await getOllamaConfig();
  if (!baseUrl) return { ok: false, error: "No Ollama server saved yet." };

  try {
    const models = await listOllamaModels(baseUrl);
    return { ok: true, baseUrl, models };
  } catch (err) {
    return { ok: false, error: messageOf(err) };
  }
}

/** Which slot a chosen model fills. */
export type ModelKind = "inference" | "embedding";

const MODEL_SETTING_KEY: Record<ModelKind, string> = {
  inference: SETTINGS.ollamaModel,
  embedding: SETTINGS.ollamaEmbeddingModel,
};

/**
 * Persist the model the admin chose for a given slot. An empty string clears
 * the selection (e.g. "no embedding model").
 */
export async function saveOllamaModel(
  kind: ModelKind,
  model: string,
): Promise<{ ok: boolean; error?: string }> {
  const adminId = await requireAdminId();
  if (adminId === null) return { ok: false, error: "Not authorized." };

  await setSetting(MODEL_SETTING_KEY[kind], model, adminId);
  return { ok: true };
}
