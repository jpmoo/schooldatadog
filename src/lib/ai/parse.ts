// Parsing helpers shared by the streaming client and the (non-streaming) server
// actions. No server-only imports — safe in the browser.

/** Pull a JSON object out of a model reply, tolerating code fences / stray prose. */
export function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const s = candidate.indexOf("{");
    const e = candidate.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(candidate.slice(s, e + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Best-effort extraction of the "reply" string from a *partial* JSON response,
 * so it can be shown as it streams in. The model emits "reply" first, so this
 * yields growing prose until the closing quote; returns "" until it appears.
 */
export function extractReplyText(partial: string): string {
  const m = partial.match(/"reply"\s*:\s*"/);
  if (!m || m.index == null) return "";
  let i = m.index + m[0].length;
  let out = "";
  while (i < partial.length) {
    const ch = partial[i];
    if (ch === "\\") {
      const next = partial[i + 1];
      if (next === undefined) break; // escape not fully arrived yet
      out += next === "n" ? "\n" : next === "t" ? "\t" : next;
      i += 2;
      continue;
    }
    if (ch === '"') break; // end of the reply string
    out += ch;
    i++;
  }
  return out;
}
