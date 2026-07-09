// Streaming AI endpoint. Proxies one chat turn to Ollama with stream:true and
// forwards just the assistant's content deltas, so the browser can show the
// reply as it's generated. Falls back to the non-streaming server actions on the
// client if this is unavailable.

import { getCurrentSession } from "@/lib/auth/session";
import { getOllamaConfig } from "@/lib/settings";
import { OLLAMA_KEEP_ALIVE } from "@/lib/ollama/warm";
import { buildWorksheetMessages, type ChatMessage, type SheetCatalog } from "@/lib/worksheet/chat";
import { buildVisualizerMessages, type VizCatalog } from "@/lib/viz/chat";

export async function POST(req: Request): Promise<Response> {
  const { user } = await getCurrentSession();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    kind?: unknown;
    messages?: unknown;
    state?: unknown;
    catalog?: unknown;
  } | null;
  const kind = body?.kind;
  if (kind !== "worksheet" && kind !== "visualizer") {
    return new Response("Bad request", { status: 400 });
  }

  const { baseUrl, model } = await getOllamaConfig();
  if (!baseUrl || !model) return new Response("AI is not configured.", { status: 503 });

  const history = (Array.isArray(body?.messages) ? body?.messages : []) as ChatMessage[];
  const messagesForOllama =
    kind === "worksheet"
      ? await buildWorksheetMessages(baseUrl, model, history, body?.state, body?.catalog as SheetCatalog)
      : await buildVisualizerMessages(baseUrl, model, history, body?.state, body?.catalog as VizCatalog);

  let ollamaRes: Response;
  try {
    ollamaRes = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        format: "json",
        options: { temperature: 0.2 },
        keep_alive: OLLAMA_KEEP_ALIVE,
        messages: messagesForOllama,
      }),
      cache: "no-store",
    });
  } catch {
    return new Response("Couldn't reach the AI server.", { status: 502 });
  }
  if (!ollamaRes.ok || !ollamaRes.body) {
    return new Response(`The AI server returned HTTP ${ollamaRes.status}.`, { status: 502 });
  }

  // Ollama streams NDJSON; forward only each line's message.content as plain text.
  const reader = ollamaRes.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as {
            message?: { content?: string };
            done?: boolean;
            eval_count?: number;
            eval_duration?: number;
            prompt_eval_count?: number;
            prompt_eval_duration?: number;
          };
          const content = obj.message?.content;
          if (content) controller.enqueue(encoder.encode(content));
          // Ollama's final chunk carries the timing stats (ns). Append them after
          // a record-separator (0x1e) so the client can split them off the reply.
          if (obj.done) {
            const stats = {
              eval_count: obj.eval_count ?? 0,
              eval_duration: obj.eval_duration ?? 0,
              prompt_eval_count: obj.prompt_eval_count ?? 0,
              prompt_eval_duration: obj.prompt_eval_duration ?? 0,
            };
            controller.enqueue(encoder.encode("\x1e" + JSON.stringify(stats)));
          }
        } catch {
          // ignore a non-JSON / partial line
        }
      }
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
