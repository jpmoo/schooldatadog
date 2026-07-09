// Client-side, DB-free handoff of the current sheet between the Data Workshop
// and the Visualizer. Both directions carry a SavedViewState (the workshop's
// serialized state) through sessionStorage: the mover stashes it and navigates,
// the destination consumes it once on mount. Consuming removes the key so a
// stale handoff never re-applies.

import type { SavedViewState } from "@/app/(app)/workshop/columns";

const TO_VISUALIZER = "sdd_handoff_to_visualizer";
const TO_WORKSHOP = "sdd_handoff_to_workshop";

function stash(key: string, state: SavedViewState) {
  try {
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    // sessionStorage can be unavailable/full — the move just won't carry data
  }
}

function take(key: string): SavedViewState | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.removeItem(key);
    return JSON.parse(raw) as SavedViewState;
  } catch {
    return null;
  }
}

export const stashForVisualizer = (state: SavedViewState) => stash(TO_VISUALIZER, state);
export const takeForVisualizer = () => take(TO_VISUALIZER);
export const stashForWorkshop = (state: SavedViewState) => stash(TO_WORKSHOP, state);
export const takeForWorkshop = () => take(TO_WORKSHOP);
