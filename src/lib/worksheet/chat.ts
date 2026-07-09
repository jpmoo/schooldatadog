"use server";

import { requireUser } from "@/lib/auth/guards";
import { getOllamaConfig } from "@/lib/settings";
import { OLLAMA_KEEP_ALIVE, OLLAMA_NUM_CTX, OLLAMA_NUM_PREDICT } from "@/lib/ollama/warm";
import { extractJson } from "@/lib/ai/parse";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type SheetCatalog = {
  metrics: { code: string; name: string; category: string | null }[];
  years: string[];
  subgroups: string[];
  groups: string[];
  counties: string[];
  homeDistrict?: string | null;
};

export type SheetChatResult =
  | { ok: true; reply: string; sheet: unknown | null }
  | { ok: false; error: string };


// The system prompt is intentionally free of any per-turn state so it stays
// byte-identical across a conversation — that lets the Ollama server reuse the
// cached prompt prefix (the large metric catalog) instead of re-evaluating it
// every turn. The volatile current-table JSON is sent as a separate message.
function systemPrompt(catalog: SheetCatalog): string {
  const byCat = new Map<string, string[]>();
  for (const m of catalog.metrics) {
    const cat = m.category ?? "Other";
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(`${m.code} — ${m.name}`);
  }
  const metricList = [...byCat.entries()].map(([cat, list]) => `## ${cat}\n${list.join("\n")}`).join("\n");

  return `You are the assistant inside the Data Workshop of "Data Dog", a tool for exploring New York State public-school data. The Workshop is a TABLE: rows are districts/schools, columns are data points (a metric for a school year and a subgroup). You help the user build and adjust that table by conversation, and answer questions about the data.

You can ONLY use data that exists. Available building blocks:

# Metric codes (use the exact code)
${metricList}

# Years (school years, use exact)
${catalog.years.join(", ")}

# Subgroups (demographic breakdowns; not every metric has every subgroup)
${catalog.subgroups.join(", ")}

# Saved groups (entity sets, by name)
${catalog.groups.length ? catalog.groups.join(", ") : "(none)"}

# Counties
${catalog.counties.join(", ")}

# The user's home district
${catalog.homeDistrict ? `${catalog.homeDistrict} — "my district" means this one.` : "(not set)"}

The current table (JSON) is provided in a separate message.

## How to respond
Reply with a single JSON object: { "reply": string, "sheet": <sheet or null> }.
- "reply": a short, friendly message (answer questions, explain what you changed, suggest other data that EXISTS).
- "sheet": include ONLY when the user wants to change the table; otherwise null.
- If the request is ambiguous — several metrics could match (e.g. "cost per pupil" when multiple cost metrics exist), or a term like "special education" might mean the "Students with Disabilities" subgroup but you aren't sure — ASK a short clarifying question in "reply" and set "sheet" to null instead of guessing. The conversation continues, so you'll get their answer next turn.

A "sheet" object looks like:
{
  "columns": [ { "id": "c1", "metric": "<code>", "year": "2023-24", "subgroup": "All Students" } ],
  "calc": [ { "name": "My score", "type": "avg", "sources": ["c1","c2"], "weights": {"c1":50,"c2":50}, "asPercent": false, "refDistrict": "<district name>" } ],
  "viewMode": "districts" | "schools" | "both" | "keep",
  "county": "<county name>" | "all" | "keep",
  "group": "<group name>" | "none" | "keep",
  "sort": { "metric": "<code>", "year": "2023-24", "direction": "desc" | "asc" } | null
}

Calculated fields (the "calc" array) derive new columns from the data columns. Pick "type":
- "avg" — average of the source columns.
- "wavg" — weighted average (use "weights", a per-source 0-100 map that sums to 100).
- "sum" — sum of the source columns.
- "min" / "max" — smallest / largest of the source columns.
- "spread" — max minus min across the sources.
- "difference" — first source minus second (uses the first two columns, in order).
- "ratio" — first source divided by second.
- "change" — change across the sources, first to last (set "asPercent": true for percent change).
- "avgchange" — average column-to-column change (supports "asPercent").
- "cagr" — compound annual growth rate across the sources, as a percent (needs 2+ columns, first & last positive).
- "slope" — linear-trend slope across the sources (needs 2+ columns).
- "zscore" — standardized score of the first source (how many std-devs from the mean of the shown rows).
- "ordinal" — ordinal rank (1, 2, 3…) by the first source. Set "direction":"desc" so the highest value is rank 1 (best score), or "asc" so the lowest value is rank 1 (lowest cost).
- "index" — 0-100 index blending the sources (weighted; each source min-max normalized first). Use "weights".
- "gap" — first source minus a reference. Set "refMode":"mean" (average of shown rows), "entity" (a district, with "refDistrict"), or "value" (a fixed number, with "refValue").
- "rank" — weighted percentile ranking of the sources (use "weights", a per-source 0-100 map that sums to 100).
- "similarity" — weighted similarity of each row to one reference district (needs "refDistrict" plus "weights").
Each calc references data columns by their "id" handle, so give the columns you need an "id".
When the user asks for any calculated field, you MUST actually add it to the "calc" array — do not just describe it in "reply". For a similarity/gap-entity field, also include every data column it uses in "columns" and reference them in the calc's "sources".

Rules:
- "columns" REPLACES all columns (data + calc). List every data column you want, left to right, each a metric code + year + subgroup + optional "id". Add "calc" fields after.
- "metric" MUST be a code above; "year"/"subgroup"/"group"/"county"/"refDistrict" MUST be real values from the lists above.
- "calc" "sources" and "weights" keys MUST be "id"s you defined in "columns".
- "viewMode":"keep", "county":"keep", "group":"keep" leave those as they are. "county":"all" clears the county filter; "group":"none" clears the group filter.
- "sort" (optional) sorts the rows by a column: use that column's metric code (and year). To sort by an existing column, just reference its metric/year — you don't need to resend it.
If you change the columns, list ALL of them (it replaces the whole table). But to ONLY sort or change the view/county/group, OMIT "columns" entirely to keep the current table — this is much faster than re-listing everything.
You can also SUGGEST a calculated field in "reply" (describe it) and only add it to "calc" when the user agrees.
Output ONLY the JSON object, no prose outside it.`;
}

// Keep the last N turns verbatim; older turns get condensed into a summary.
const KEEP_RECENT = 12;

async function summarizeHistory(baseUrl: string, model: string, older: ChatMessage[]): Promise<string> {
  const transcript = older.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX, num_predict: OLLAMA_NUM_PREDICT },
        keep_alive: OLLAMA_KEEP_ALIVE,
        messages: [
          {
            role: "system",
            content:
              "Summarize this data-table conversation in 4-6 sentences. Preserve concrete decisions: metrics, years, subgroups, entity filters, and any unresolved requests. Be terse.",
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
 * volatile table state, and the conversation (older turns condensed). Shared by
 * the non-streaming action below and the streaming route handler.
 */
export async function buildWorksheetMessages(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  currentState: unknown,
  catalog: SheetCatalog,
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
  return [
    { role: "system", content: systemPrompt(catalog) },
    { role: "system", content: `# The current table (JSON)\n${JSON.stringify(currentState)}` },
    ...history,
  ];
}

/** One turn of the Workshop AI conversation (best-effort, via Ollama chat). */
export async function worksheetChat(
  messages: ChatMessage[],
  currentState: unknown,
  catalog: SheetCatalog,
): Promise<SheetChatResult> {
  await requireUser();
  const { baseUrl, model } = await getOllamaConfig();
  if (!baseUrl || !model) {
    return {
      ok: false,
      error: "AI isn't configured. An admin can set the Ollama server and inference model in System Settings.",
    };
  }

  try {
    const messagesForOllama = await buildWorksheetMessages(baseUrl, model, messages, currentState, catalog);
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0.2, num_ctx: OLLAMA_NUM_CTX, num_predict: OLLAMA_NUM_PREDICT },
        keep_alive: OLLAMA_KEEP_ALIVE,
        messages: messagesForOllama,
      }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `The AI server returned HTTP ${res.status}.` };
    const data = (await res.json()) as { message?: { content?: string } };
    const content = data?.message?.content ?? "";
    const parsed = extractJson(content);
    if (parsed) {
      return { ok: true, reply: typeof parsed.reply === "string" ? parsed.reply : "", sheet: parsed.sheet ?? null };
    }
    return { ok: true, reply: content || "(no response)", sheet: null };
  } catch {
    return { ok: false, error: "Couldn't reach the AI server." };
  }
}
