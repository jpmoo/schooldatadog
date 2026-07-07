"use client";

import { useEffect, useState, useTransition } from "react";
import {
  connectOllama,
  refreshOllamaModels,
  saveOllamaModel,
  type ModelKind,
} from "@/lib/ollama/actions";
import type { OllamaModel } from "@/lib/ollama/client";

type Status =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ok"; message: string }
  | { type: "error"; message: string };

function modelLabel(m: OllamaModel): string {
  const meta = [m.parameterSize, m.size].filter(Boolean).join(" · ");
  return meta ? `${m.name}  (${meta})` : m.name;
}

function ModelPicker({
  label,
  description,
  value,
  models,
  disabled,
  allowNone,
  saved,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  models: OllamaModel[];
  disabled: boolean;
  allowNone: boolean;
  saved: boolean;
  onChange: (model: string) => void;
}) {
  const selectionMissing =
    value !== "" && models.length > 0 && !models.some((m) => m.name === value);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </label>
      <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      >
        {models.length === 0 ? (
          <option value="">Connect to load models…</option>
        ) : (
          <>
            {allowNone ? (
              <option value="">— None —</option>
            ) : (
              <option value="" disabled>
                Select a model…
              </option>
            )}
            {selectionMissing && (
              <option value={value}>{value} (not currently installed)</option>
            )}
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {modelLabel(m)}
              </option>
            ))}
          </>
        )}
      </select>
      {saved && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>
      )}
      {selectionMissing && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          The saved model “{value}” isn’t installed on this server anymore.
        </p>
      )}
    </div>
  );
}

export function OllamaSettings({
  initialBaseUrl,
  initialModel,
  initialEmbeddingModel,
}: {
  initialBaseUrl: string;
  initialModel: string;
  initialEmbeddingModel: string;
}) {
  const [url, setUrl] = useState(initialBaseUrl);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [inferenceModel, setInferenceModel] = useState(initialModel);
  const [embeddingModel, setEmbeddingModel] = useState(initialEmbeddingModel);
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const [savedKind, setSavedKind] = useState<ModelKind | null>(null);
  const [isPending, startTransition] = useTransition();

  function applyResult(res: Awaited<ReturnType<typeof connectOllama>>) {
    if (res.ok) {
      setModels(res.models);
      setUrl(res.baseUrl);
      setStatus({
        type: "ok",
        message: res.models.length
          ? `Connected — ${res.models.length} model${
              res.models.length === 1 ? "" : "s"
            } available.`
          : "Connected, but no models are installed on this server.",
      });
    } else {
      setModels([]);
      setStatus({ type: "error", message: res.error });
    }
  }

  function handleConnect() {
    setSavedKind(null);
    startTransition(async () => {
      setStatus({ type: "loading" });
      applyResult(await connectOllama(url));
    });
  }

  function handleRefresh() {
    setSavedKind(null);
    startTransition(async () => {
      setStatus({ type: "loading" });
      applyResult(await refreshOllamaModels());
    });
  }

  function handleSelect(kind: ModelKind, model: string) {
    if (kind === "inference") setInferenceModel(model);
    else setEmbeddingModel(model);
    setSavedKind(null);
    startTransition(async () => {
      const res = await saveOllamaModel(kind, model);
      if (res.ok) setSavedKind(kind);
      else setStatus({ type: "error", message: res.error ?? "Could not save." });
    });
  }

  // Load models on first render if a server is already configured.
  useEffect(() => {
    if (initialBaseUrl) handleRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelsLoaded = models.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Server address */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-semibold text-slate-900 dark:text-white">
          Ollama server
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Enter the IP address and port where Ollama is running. Port defaults
          to <code className="text-xs">11434</code> if omitted.
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnect();
            }}
            placeholder="192.168.1.50:11434"
            spellCheck={false}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={handleConnect}
            disabled={isPending || url.trim() === ""}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {isPending ? "Connecting…" : "Connect"}
          </button>
        </div>

        {status.type !== "idle" && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span
              className={
                status.type === "ok"
                  ? "inline-block h-2 w-2 rounded-full bg-emerald-500"
                  : status.type === "error"
                    ? "inline-block h-2 w-2 rounded-full bg-red-500"
                    : "inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400"
              }
            />
            <span
              className={
                status.type === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-slate-600 dark:text-slate-300"
              }
            >
              {status.type === "loading"
                ? "Contacting server…"
                : status.message}
            </span>
          </div>
        )}
      </section>

      {/* Model selection */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 dark:text-white">
            Models
          </h2>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isPending}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isPending ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-6">
          <ModelPicker
            label="Inference model"
            description="The main model for chat, grouping, and prompting over school data."
            value={inferenceModel}
            models={models}
            disabled={isPending || !modelsLoaded}
            allowNone={false}
            saved={savedKind === "inference"}
            onChange={(m) => handleSelect("inference", m)}
          />
          <ModelPicker
            label="Embedding model"
            description="Generates embeddings for semantic search (e.g. nomic-embed-text, mxbai-embed-large)."
            value={embeddingModel}
            models={models}
            disabled={isPending || !modelsLoaded}
            allowNone
            saved={savedKind === "embedding"}
            onChange={(m) => handleSelect("embedding", m)}
          />
        </div>
      </section>
    </div>
  );
}
