"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity/log";
import { requireAdmin } from "@/lib/auth/guards";
import { describeSchedule, type BackupConfig } from "@/lib/backup/config";
import { deleteBackup, performBackup, type BackupResult } from "@/lib/backup/run";
import { applyBackupSchedule } from "@/lib/backup/scheduler";
import { SETTINGS, setSetting } from "@/lib/settings";

/** Run a backup immediately (from the "Back up now" button). */
export async function runBackupNow(): Promise<BackupResult> {
  const user = await requireAdmin();
  const result = await performBackup(user.id);
  revalidatePath("/admin/backup");
  return result;
}

const scheduleSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  weekday: z.number().int().min(0).max(6),
  retention: z.number().int().min(1).max(365),
});

export type SaveScheduleResult = { ok: true } | { ok: false; error: string };

/** Persist the schedule + retention and (re)arm the in-process timer. */
export async function saveBackupSchedule(input: BackupConfig): Promise<SaveScheduleResult> {
  const user = await requireAdmin();
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid schedule." };
  }
  const c = parsed.data;

  await Promise.all([
    setSetting(SETTINGS.backupEnabled, c.enabled ? "1" : "0", user.id),
    setSetting(SETTINGS.backupFrequency, c.frequency, user.id),
    setSetting(SETTINGS.backupHour, String(c.hour), user.id),
    setSetting(SETTINGS.backupMinute, String(c.minute), user.id),
    setSetting(SETTINGS.backupWeekday, String(c.weekday), user.id),
    setSetting(SETTINGS.backupRetention, String(c.retention), user.id),
  ]);

  await applyBackupSchedule();
  await logActivity(user.id, "backup.schedule", "backup", describeSchedule(c));
  revalidatePath("/admin/backup");
  return { ok: true };
}

/** Delete a single backup file (from the list). */
export async function removeBackup(name: string): Promise<{ ok: boolean }> {
  await requireAdmin();
  const ok = await deleteBackup(name);
  revalidatePath("/admin/backup");
  return { ok };
}
