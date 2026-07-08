"use server";

import { requireUser } from "@/lib/auth/guards";
import { getOllamaConfig } from "@/lib/settings";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type VizCatalog = {
  metrics: { code: string; name: string; category: string | null }[];
  years: string[];
  subgroups: string[];
  groups: string[];
};

export type ChatResult =
  | { ok: true; reply: string; chart: unknown | null }
  | { ok: false; error: string };

/** Pull a JSON object out of a model reply, tolerating code fences / stray prose. */
function extractJson(text: string): { reply?: unknown; chart?: unknown } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const s = candidate.indexOf("{");
    const e = candidate.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(candidate.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function systemPrompt(catalog: VizCatalog, currentSpec: unknown): string {
  const byCat = new Map<string, string[]>();
  for (const m of catalog.metrics) {
    const cat = m.category ?? "Other";
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(`${m.code} — ${m.name}`);
  }
  const metricList = [...byCat.entries()]
    .map(([cat, list]) => `## ${cat}\n${list.join("\n")}`)
    .join("\n");

  return `You are the charting assistant inside "Data Dog", a tool for exploring New York State public-school data (districts and schools). You help the user build and refine a chart by conversation, and you answer questions about the data and how to present it.

You can ONLY use data that exists. Available building blocks:

# Metric codes (use the exact code)
${metricList}

# Years (school years, use exact)
${catalog.years.join(", ")}

# Subgroups (demographic breakdowns; not every metric has every subgroup)
${catalog.subgroups.join(", ")}

# Saved groups (entity sets, by name)
${catalog.groups.length ? catalog.groups.join(", ") : "(none)"}

# The current chart (JSON)
${JSON.stringify(currentSpec)}

## How to respond
Reply with a single JSON object: { "reply": string, "chart": <chart or null> }.
- "reply": a short, friendly message to the user (answer questions, give advice, explain what you changed, suggest other data that EXISTS, or suggest a better framing).
- "chart": include this ONLY when the user wants you to build or change the chart; otherwise null.

A "chart" object looks like:
{
  "entities": "districts" | "schools" | "both" | {"group":"Group Name"} | "keep",
  "fields": [ { "id": "a", "metric": "<metric_code>", "years": ["2023-24"], "subgroup": "All Students", "label": "Short label" } ],
  "mark": "bar" | "line" | "point" | "area" | "rect",
  "encoding": { "x": {"field":"<ref>","type":"nominal|ordinal|quantitative|temporal"}, "y": {...}, "color": {...}, "column": {...} },
  "title": "Chart title"
}
Rules:
- "metric" MUST be one of the codes above. "years" and "subgroup" MUST be from the lists above.
- Field "id" is your short handle; reference it in encoding channels.
- Encoding channel "field" is either a field id, or a built-in column: "entityName", "year", "county".
- For a line over time: put MULTIPLE years on ONE field, then x = {"field":"year","type":"ordinal"}, y = that field, color = {"field":"entityName","type":"nominal"}.
- For comparing entities on one metric: mark "bar", x = entityName, y = the field.
- "entities":"keep" leaves the current entity set unchanged.
Keep charts readable. Output ONLY the JSON object, no prose outside it.`;
}

/** One turn of the Visualizer AI conversation (best-effort, via Ollama chat). */
export async function visualizerChat(
  messages: ChatMessage[],
  currentSpec: unknown,
  catalog: VizCatalog,
): Promise<ChatResult> {
  await requireUser();
  const { baseUrl, model } = await getOllamaConfig();
  if (!baseUrl || !model) {
    return {
      ok: false,
      error: "AI isn't configured. An admin can set the Ollama server and inference model in System Settings.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
        messages: [{ role: "system", content: systemPrompt(catalog, currentSpec) }, ...messages],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `The AI server returned HTTP ${res.status}.` };
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data?.message?.content ?? "";
    const parsed = extractJson(content);
    if (parsed) {
      return {
        ok: true,
        reply: typeof parsed.reply === "string" ? parsed.reply : "",
        chart: parsed.chart ?? null,
      };
    }
    // No JSON at all — treat the whole thing as a prose answer.
    return { ok: true, reply: content || "(no response)", chart: null };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, error: aborted ? "The AI took too long to respond." : "Couldn't reach the AI server." };
  } finally {
    clearTimeout(timer);
  }
}
