/**
 * Ollama embeddings. Kept free of `server-only` so the standalone embed script
 * (run via tsx) can import it as well as server code. Hits POST /api/embed,
 * which accepts a batch of inputs and returns one vector per input.
 */

export class OllamaEmbedError extends Error {}

export async function embedTexts(
  baseUrl: string,
  model: string,
  inputs: string[],
  timeoutMs = 120_000,
): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, input: inputs }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new OllamaEmbedError(
        `Ollama /api/embed returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    const data = (await res.json()) as { embeddings?: unknown };
    const embeddings = data?.embeddings;
    if (
      !Array.isArray(embeddings) ||
      embeddings.length !== inputs.length ||
      !embeddings.every((v) => Array.isArray(v))
    ) {
      throw new OllamaEmbedError(
        "Unexpected /api/embed response (missing or malformed embeddings).",
      );
    }
    return embeddings as number[][];
  } catch (err) {
    if (err instanceof OllamaEmbedError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new OllamaEmbedError(`Embedding request timed out after ${timeoutMs / 1000}s.`);
    }
    throw new OllamaEmbedError(
      `Could not reach the Ollama server at ${baseUrl} for embeddings.`,
    );
  } finally {
    clearTimeout(timer);
  }
}
