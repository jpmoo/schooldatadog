"use server";

import { requireUser } from "@/lib/auth/guards";
import { warmOllama } from "./warm";

/** Preload the inference model for a signed-in user (best-effort, non-blocking). */
export async function warmUpModel(): Promise<void> {
  await requireUser();
  void warmOllama();
}
