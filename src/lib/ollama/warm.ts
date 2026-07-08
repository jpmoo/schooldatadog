import "server-only";

import { getOllamaConfig } from "@/lib/settings";

/** How long Ollama keeps a model loaded while idle (sent on every request). */
export const OLLAMA_KEEP_ALIVE = "4h";

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
      body: JSON.stringify({ model, keep_alive: OLLAMA_KEEP_ALIVE }),
      cache: "no-store",
    });
  } catch {
    // ignore — warming is best-effort
  }
}
