import "server-only";

/** Ollama's default port when the admin doesn't specify one. */
const DEFAULT_PORT = "11434";
const REQUEST_TIMEOUT_MS = 6000;

export type OllamaModel = {
  /** Full tag, e.g. "llama3.1:8b". This is what you pass to the API. */
  name: string;
  /** Human-ish size, e.g. "4.7 GB". */
  size: string | null;
  /** e.g. "8B" from model details. */
  parameterSize: string | null;
  /** e.g. "llama". */
  family: string | null;
};

export class OllamaError extends Error {}

/**
 * Normalize whatever the admin typed ("192.168.1.50", "192.168.1.50:11434",
 * "http://host:11434/") into a clean origin "http://host:port".
 * Throws OllamaError on anything unparseable.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new OllamaError("Enter the Ollama server address.");

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new OllamaError("That doesn't look like a valid address.");
  }

  if (!url.hostname) throw new OllamaError("Missing host in the address.");
  const port = url.port || DEFAULT_PORT;
  return `${url.protocol}//${url.hostname}:${port}`;
}

async function ollamaFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      // Never cache admin connectivity probes.
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new OllamaError(
        `No response within ${REQUEST_TIMEOUT_MS / 1000}s — is the server reachable?`,
      );
    }
    throw new OllamaError(
      "Could not reach the server. Check the address and that Ollama is running.",
    );
  } finally {
    clearTimeout(timer);
  }
}

function formatBytes(bytes: unknown): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return null;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

/**
 * List the models installed on the Ollama server. Hits GET /api/tags.
 * Throws OllamaError with a friendly message on any failure.
 */
export async function listOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
  const res = await ollamaFetch(`${baseUrl}/api/tags`);
  if (!res.ok) {
    throw new OllamaError(`Ollama responded with HTTP ${res.status}.`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new OllamaError("Got an unexpected response (not JSON) from the server.");
  }

  const models = (data as { models?: unknown })?.models;
  if (!Array.isArray(models)) return [];

  return models
    .map((m): OllamaModel | null => {
      const rec = m as {
        name?: unknown;
        size?: unknown;
        details?: { parameter_size?: unknown; family?: unknown };
      };
      if (typeof rec.name !== "string") return null;
      return {
        name: rec.name,
        size: formatBytes(rec.size),
        parameterSize:
          typeof rec.details?.parameter_size === "string"
            ? rec.details.parameter_size
            : null,
        family:
          typeof rec.details?.family === "string" ? rec.details.family : null,
      };
    })
    .filter((m): m is OllamaModel => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
