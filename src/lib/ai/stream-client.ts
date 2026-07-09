// Browser-side streaming call to the AI route handler. Streams the assistant's
// prose reply as it's generated (via onReply), then returns the final reply plus
// the structured command (sheet/chart) parsed from the whole response.

import { extractJson, extractReplyText } from "@/lib/ai/parse";

/** Generation-speed stats from Ollama's final chunk (null on the fallback path). */
export type AiTimings = { tokens: number; tokensPerSec: number } | null;

export type StreamAiResult =
  | { ok: true; reply: string; command: unknown | null; timings: AiTimings }
  | { ok: false; error: string };

// The route handler appends the timing JSON after this separator.
const STATS_SEP = "\x1e";

// Keys that signal the model is emitting a sheet/chart command (not prose).
const COMMAND_KEY_RE = /"(sheet|columns|chart|fields|encoding)"\s*:/;

/** "12.3 tok/s · 240 tokens · 3.9s" — a compact readout for the AI panel. */
export function formatAiStats(s: { seconds: number; tokens?: number; tokensPerSec?: number }): string {
  const parts: string[] = [];
  if (s.tokensPerSec) parts.push(`${s.tokensPerSec.toFixed(1)} tok/s`);
  if (s.tokens) parts.push(`${s.tokens} tokens`);
  parts.push(`${s.seconds.toFixed(1)}s`);
  return parts.join(" · ");
}

export async function streamAiChat(
  kind: "worksheet" | "visualizer",
  payload: { messages: unknown; state: unknown; catalog: unknown },
  onReply: (partialReply: string) => void,
  signal?: AbortSignal,
): Promise<StreamAiResult> {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  // Once the model starts emitting the structured command, show a status instead
  // of leaking JSON into the chat.
  const buildingMsg =
    kind === "worksheet" ? "Building the table…" : "Building the visualization…";
  let raw = "";
  try {
    const res = await fetch(`${basePath}/api/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ...payload }),
      signal,
    });
    if (!res.ok || !res.body) {
      return { ok: false, error: `The AI server returned HTTP ${res.status}.` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      const content = raw.split(STATS_SEP)[0];
      const replyText = extractReplyText(content);
      // A command key (or a reply that itself looks like JSON) means we're
      // building — never render the raw JSON, show the status instead.
      const building = COMMAND_KEY_RE.test(content) || /^\s*[[{]/.test(replyText);
      onReply(building ? buildingMsg : replyText);
    }
  } catch {
    return { ok: false, error: "Couldn't reach the AI server." };
  }

  const [content, statsPart] = raw.split(STATS_SEP);
  const parsed = extractJson(content);
  const reply =
    parsed && typeof parsed.reply === "string"
      ? parsed.reply
      : extractReplyText(content) || content.trim() || "(no response)";
  const command = parsed
    ? kind === "worksheet"
      ? (parsed.sheet ?? null)
      : (parsed.chart ?? null)
    : null;

  let timings: AiTimings = null;
  if (statsPart) {
    try {
      const s = JSON.parse(statsPart) as { eval_count?: number; eval_duration?: number };
      if (s.eval_count && s.eval_duration) {
        timings = { tokens: s.eval_count, tokensPerSec: s.eval_count / (s.eval_duration / 1e9) };
      }
    } catch {
      // ignore malformed stats
    }
  }
  return { ok: true, reply, command, timings };
}
