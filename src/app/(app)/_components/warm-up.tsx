"use client";

import { useEffect } from "react";
import { warmUpModel } from "@/lib/ollama/warm-action";

/**
 * Preload the Ollama inference model once per browser session, so the first AI
 * prompt after opening the app isn't a cold start. Renders nothing.
 */
export function WarmUp() {
  useEffect(() => {
    if (sessionStorage.getItem("sdd_warmed")) return;
    sessionStorage.setItem("sdd_warmed", "1");
    void warmUpModel().catch(() => {});
  }, []);
  return null;
}
