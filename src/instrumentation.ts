// Runs once when a Next.js server instance starts. We use it to arm the
// automated database-backup timer (see @/lib/backup/scheduler). Guarded to the
// Node.js runtime so the Edge bundle never pulls in fs / child_process.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { applyBackupSchedule } = await import("@/lib/backup/scheduler");
    await applyBackupSchedule();
  } catch (err) {
    console.error("[backup] failed to initialize the backup scheduler:", err);
  }
}
