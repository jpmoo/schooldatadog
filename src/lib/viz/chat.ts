"use server";

import { requireUser } from "@/lib/auth/guards";
import { getOllamaConfig } from "@/lib/settings";
import { OLLAMA_KEEP_ALIVE, OLLAMA_NUM_CTX, OLLAMA_NUM_PREDICT } from "@/lib/ollama/warm";
import { extractJson } from "@/lib/ai/parse";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type VizCatalog = {
  metrics: { code: string; name: string; category: string | null }[];
  years: string[];
  subgroups: string[];
  groups: string[];
  /** The user's own district, so "my district" resolves. */
  homeDistrict?: string | null;
  /** Entities already on the chart (e.g. from an imported view), by name. */
  selectedEntities?: string[];
};

export type ChatResult =
  | { ok: true; reply: string; chart: unknown | null }
  | { ok: false; error: string };


// Kept free of per-turn state (entity list, chart JSON) so it stays identical
// across a conversation and the Ollama server can reuse the cached prompt prefix
// (the big metric catalog) instead of re-evaluating it every turn.
function systemPrompt(catalog: VizCatalog): string {
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

# The user's home district
${catalog.homeDistrict ? `${catalog.homeDistrict} — when the user says "my district", they mean this one.` : "(not set — if the user references their district and you don't know it, ask.)"}

The entities currently on the chart and the current chart JSON are included at the end of this message.
If the user already has a selection, ALWAYS use "entities":"keep" so the chart is built from EXACTLY that set (they often chose it deliberately, e.g. by importing a view). Do NOT switch to "districts"/"schools"/"both" (all entities) unless the user explicitly says "all districts", "every school", "statewide", etc. A histogram/count over "these districts" means a count over the SELECTED set, not the whole state.

## How to respond
Reply with a single JSON object: { "reply": string, "chart": <chart or null> }.
- "reply": a short, friendly message to the user (answer questions, give advice, explain what you changed, suggest other data that EXISTS, or suggest a better framing).
- "chart": include this ONLY when the user wants you to build or change the chart; otherwise null.
- If the request is ambiguous — several metrics could match (e.g. "cost per pupil" when multiple cost metrics exist), or a term like "special education" might mean the "Students with Disabilities" subgroup but you aren't sure — ASK a short clarifying question in "reply" and set "chart" to null instead of guessing. The conversation continues, so you'll get their answer next turn.

A "chart" object looks like:
{
  "entities": "districts" | "schools" | "both" | {"group":"Group Name"} | "keep",
  "fields": [ { "id": "a", "metric": "<metric_code>", "years": ["2023-24"], "subgroup": "All Students", "label": "Short label" } ],
  "mark": "bar" | "line" | "point" | "area" | "rect",
  "encoding": { "x": {"field":"<ref>","type":"nominal|ordinal|quantitative|temporal"}, "y": {...}, "color": {...}, "column": {...} },
  "title": "Chart title",
  "showLegend": true | false,   // optional — hide the colour/size legend
  "theme": "app" | "print",      // optional — colour palette
  "refLines": [ { "axis": "y", "aggregate": "mean", "field": "<field id>", "label": "Average" } ]  // optional — dashed guide lines
}
Return the FULL chart object each time you change anything — include every field, entity, encoding channel, and setting you want, because it REPLACES the current chart. Don't send a partial chart expecting the rest to stay.
Rules:
- "metric" MUST be one of the codes above. "years" and "subgroup" MUST be from the lists above.
- Field "id" is your short handle; reference it in encoding channels.
- Encoding channel "field" is either a field id, or a built-in column: "entityName", "year", "county", "homeDistrict".
- For a line over time: put MULTIPLE years on ONE field, then x = {"field":"year","type":"ordinal"}, y = that field, color = {"field":"entityName","type":"nominal"}.
- For comparing entities on one metric: mark "bar", x = entityName, y = the field.
- For several years side-by-side per entity (grouped bars): ONE field with MULTIPLE years, mark "bar", x = entityName, y = the field, xOffset = {"field":"year","type":"nominal"}, color = {"field":"year","type":"nominal"}.
- To HIGHLIGHT the user's own district WITHOUT changing the colour scheme, fade everyone else with an opacity condition on the built-in "homeDistrict" field (value "My district" for the user's district and its schools, "Other" otherwise):
  "opacity": { "condition": { "test": "datum.homeDistrict === 'My district'", "value": 1 }, "value": 0.3 }
  Keep any existing color encoding as-is. This works on every chart type (their bar/bin/point stays fully opaque while the rest dim). So you CAN highlight the user's district — do it this way, not by recolouring.
- For a histogram: x = a field with {"bin": true}, y = {"aggregate": "count"}, mark "bar".
- "entities":"keep" leaves the current entity set unchanged (this is the default when entities are already selected).
- "refLines" (optional) draws dashed guide lines across the plot — a benchmark or average. Each: "axis" ("y" = horizontal line, "x" = vertical), then EITHER "value": <number> for a fixed line, OR "aggregate": "mean"|"median"|"min"|"max" with "field": <a field id> to compute it from the shown data. Give a short "label". You CAN do this — offer a reference line when an average or target would help (e.g. "add a line at the state average" → refLines with aggregate "mean" on the value field). Send "refLines": [] to remove them. Do NOT offer free-form text callouts, trend lines, or shaded regions — only these guide lines are supported.
Keep charts readable. Output ONLY the JSON object, no prose outside it.`;
}

// Keep the last N turns verbatim; older turns get condensed into a summary so
// the conversation stays in context without growing unbounded.
const KEEP_RECENT = 12;

async function summarizeHistory(
  baseUrl: string,
  model: string,
  older: ChatMessage[],
): Promise<string> {
  const transcript = older.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX, num_predict: OLLAMA_NUM_PREDICT },
        think: false, // reasoning model — skip the (slow, unused) chain-of-thought
        keep_alive: OLLAMA_KEEP_ALIVE,
        messages: [
          {
            role: "system",
            content:
              "Summarize this chart-building conversation in 4-6 sentences. Preserve concrete decisions: the metric(s), entities, year(s), chart type, styling, and any unresolved requests. Be terse.",
          },
          { role: "user", content: transcript },
        ],
      }),
      cache: "no-store",
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { message?: { content?: string } };
    return (data?.message?.content ?? "").trim();
  } catch {
    return "";
  }
}

export type PromptMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Assemble the Ollama message list: a static (cacheable) system prompt, the
 * volatile entity/chart state, and the conversation (older turns condensed).
 * Shared by the non-streaming action below and the streaming route handler.
 */
export async function buildVisualizerMessages(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  currentSpec: unknown,
  catalog: VizCatalog,
): Promise<PromptMessage[]> {
  let history: ChatMessage[] = messages;
  if (messages.length > KEEP_RECENT + 4) {
    const older = messages.slice(0, messages.length - KEEP_RECENT);
    const recent = messages.slice(messages.length - KEEP_RECENT);
    const summary = await summarizeHistory(baseUrl, model, older);
    history = summary
      ? [{ role: "user", content: `Summary of our earlier conversation:\n${summary}` }, ...recent]
      : recent;
  }
  const sel = catalog.selectedEntities ?? [];
  const entityLine = sel.length
    ? `${sel.length} selected: ${sel.slice(0, 80).join(", ")}${sel.length > 80 ? `, …(+${sel.length - 80} more)` : ""}`
    : "(none selected yet)";
  const stateMsg = `# Entities currently on the chart\n${entityLine}\n\n# The current chart (JSON)\n${JSON.stringify(currentSpec)}`;
  return [
    { role: "system", content: `${systemPrompt(catalog)}\n\n${stateMsg}` },
    ...history,
  ];
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
      error: "Scout isn't configured. An admin can set the Ollama server and inference model in Administration.",
    };
  }

  // No client-side timeout — a local model can legitimately take minutes to
  // think, especially for open-ended questions. Let it run to completion.
  try {
    const messagesForOllama = await buildVisualizerMessages(baseUrl, model, messages, currentSpec, catalog);
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.2, num_ctx: OLLAMA_NUM_CTX, num_predict: OLLAMA_NUM_PREDICT },
        think: false, // reasoning model — skip the (slow, unused) chain-of-thought
        keep_alive: OLLAMA_KEEP_ALIVE,
        messages: messagesForOllama,
      }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `Scout's server returned HTTP ${res.status}.` };
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
  } catch {
    return { ok: false, error: "Couldn't reach Scout." };
  }
}
