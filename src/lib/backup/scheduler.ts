import "server-only";

import { nextBackupRun } from "@/lib/backup/config";
import { performBackup } from "@/lib/backup/run";
import { getBackupConfig } from "@/lib/settings";

// The pending timer lives on globalThis so it's a true singleton: instrumentation
// and server-action bundles are compiled separately and would otherwise each get
// their own module copy (and their own timer).
const g = globalThis as typeof globalThis & {
  __sddBackupTimer?: ReturnType<typeof setTimeout> | null;
};

// setTimeout stores a 32-bit delay; anything longer fires immediately. Daily and
// weekly are always well under this, but clamp to be safe.
const MAX_DELAY = 2 ** 31 - 1;

/**
 * Read the current schedule and arm a one-shot timer for the next run. Re-arming
 * after each fire keeps us on schedule and picks up any settings change. Called
 * on server boot (instrumentation) and whenever the admin saves the schedule.
 */
export async function applyBackupSchedule(): Promise<void> {
  if (g.__sddBackupTimer) {
    clearTimeout(g.__sddBackupTimer);
    g.__sddBackupTimer = null;
  }

  const config = await getBackupConfig();
  if (!config.enabled) return;

  const delay = Math.min(MAX_DELAY, Math.max(1000, nextBackupRun(config).getTime() - Date.now()));
  g.__sddBackupTimer = setTimeout(() => {
    void performBackup(null)
      .catch(() => {})
      .finally(() => {
        // Chain the following occurrence (and re-read config in case it changed).
        void applyBackupSchedule();
      });
  }, delay);
}
