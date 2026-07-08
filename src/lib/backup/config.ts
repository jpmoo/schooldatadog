// Shared backup-schedule types + pure helpers. No DB, node, or server-only
// imports here so this module is safe to use from client components too (the
// admin UI imports describeSchedule / WEEKDAY_NAMES).

export type BackupFrequency = "daily" | "weekly";

export type BackupConfig = {
  enabled: boolean;
  frequency: BackupFrequency;
  hour: number; // 0–23, server local time
  minute: number; // 0–59
  weekday: number; // 0 (Sun) – 6 (Sat); used only when frequency = "weekly"
  retention: number; // how many backups to keep (older ones are pruned)
};

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  enabled: false,
  frequency: "daily",
  hour: 2,
  minute: 0,
  weekday: 0,
  retention: 7,
};

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "2:00 AM"-style label for an hour/minute. */
export function formatClock(hour: number, minute: number): string {
  const h12 = ((hour + 11) % 12) + 1;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

/** Plain-language description of when backups run (server local time). */
export function describeSchedule(c: BackupConfig): string {
  if (!c.enabled) return "Scheduled backups are off.";
  const time = formatClock(c.hour, c.minute);
  return c.frequency === "daily"
    ? `Every day at ${time}`
    : `Every ${WEEKDAY_NAMES[c.weekday] ?? "Sunday"} at ${time}`;
}

/**
 * The next moment this schedule should fire, in the server's local time zone.
 * Both daily and weekly are always ≤ 7 days out, well within setTimeout's range.
 */
export function nextBackupRun(c: BackupConfig, from: Date = new Date()): Date {
  const next = new Date(from);
  next.setHours(c.hour, c.minute, 0, 0);

  if (c.frequency === "daily") {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  // weekly: advance to the target weekday, then bump a week if it's already past
  const delta = (c.weekday - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + delta);
  if (next <= from) next.setDate(next.getDate() + 7);
  return next;
}
