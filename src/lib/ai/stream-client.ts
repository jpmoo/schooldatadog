// Browser-side streaming call to the AI route handler. Streams the assistant's
// prose reply as it's generated (via onReply), then returns the final reply plus
// the structured command (sheet/chart) parsed from the whole response.

import { extractJson, extractReplyText } from "@/lib/ai/parse";

export type StreamAiResult =
  | { ok: true; reply: string; command: unknown | null }
  | { ok: false; error: string };

export async function streamAiChat(
  kind: "worksheet" | "visualizer",
  payload: { messages: unknown; state: unknown; catalog: unknown },
  onReply: (partialReply: string) => void,
): Promise<StreamAiResult> {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  let raw = "";
  try {
    const res = await fetch(`${basePath}/api/ai/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, ...payload }),
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
      onReply(extractReplyText(raw));
    }
  } catch {
    return { ok: false, error: "Couldn't reach the AI server." };
  }

  const parsed = extractJson(raw);
  const reply =
    parsed && typeof parsed.reply === "string"
      ? parsed.reply
      : extractReplyText(raw) || raw.trim() || "(no response)";
  const command = parsed
    ? kind === "worksheet"
      ? (parsed.sheet ?? null)
      : (parsed.chart ?? null)
    : null;
  return { ok: true, reply, command };
}
