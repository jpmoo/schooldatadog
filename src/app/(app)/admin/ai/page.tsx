import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { getOllamaConfig } from "@/lib/settings";
import { OllamaSettings } from "./ollama-settings";

export default async function AiSettingsPage() {
  await requireAdmin();
  const { baseUrl, model, embeddingModel } = await getOllamaConfig();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← System Settings
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
          AI / Ollama
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Point Data Dog at your Ollama server and choose the model used
          for AI-assisted analysis.
        </p>
      </div>

      <OllamaSettings
        initialBaseUrl={baseUrl ?? ""}
        initialModel={model ?? ""}
        initialEmbeddingModel={embeddingModel ?? ""}
      />
    </div>
  );
}
