import "server-only";

import { getOllamaConfig } from "@/lib/settings";

/** How long Ollama keeps a model loaded while idle (sent on every request). */
export const OLLAMA_KEEP_ALIVE = "4h";

/**
 * Context window (tokens). Ollama defaults to only 4096, which the metric
 * catalog + rules + a big command (e.g. a 6-source similarity) can exceed —
 * forcing slow context-shifting. Set generously and use the SAME value on every
 * request (chat, summarize, warm-up) so Ollama doesn't reload the model when the
 * size changes.
 */
export const OLLAMA_NUM_CTX = 8192;

/**
 * Hard cap on generated tokens. Any real reply or sheet/chart command fits well
 * under this; it exists so a confused model can never run away and hang the UI
 * for minutes. (A generation param, not a load param — safe to vary per call.)
 */
export const OLLAMA_NUM_PREDICT = 2048;

/**
 * Preload the inference model into Ollama so the first real prompt is fast, and
 * set a long idle keep-alive. Best-effort and non-blocking — a slow/absent
 * Ollama must never affect the caller (e.g. login).
 */
export async function warmOllama(): Promise<void> {
  const { baseUrl, model } = await getOllamaConfig();
  if (!baseUrl || !model) return;
  try {
    // An empty prompt makes /api/generate a load-only request.
    await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Load at the same context size chat uses, so the first real prompt
      // doesn't trigger a reload.
      body: JSON.stringify({ model, keep_alive: OLLAMA_KEEP_ALIVE, options: { num_ctx: OLLAMA_NUM_CTX } }),
      cache: "no-store",
    });
  } catch {
    // ignore — warming is best-effort
  }
}
