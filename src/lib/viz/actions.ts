"use server";

import { getView } from "@/lib/views/queries";
import type { SavedViewState } from "@/app/(app)/workshop/columns";

/** Load a saved view's state so the Visualizer can import it (ownership-checked). */
export async function getViewForImport(id: number): Promise<SavedViewState | null> {
  const v = await getView(id);
  return v?.state ?? null;
}
