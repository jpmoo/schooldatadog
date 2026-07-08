import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { BACKUP_DIR, listBackups } from "@/lib/backup/run";
import { getBackupConfig } from "@/lib/settings";
import { BackupSettings } from "./backup-settings";

export default async function BackupPage() {
  await requireAdmin();
  const [config, backups] = await Promise.all([getBackupConfig(), listBackups()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Administration
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
          Database Backups
        </h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">
          Schedule automatic backups of the whole database and keep a rolling set of
          the most recent ones, or run a backup on demand.
        </p>
      </div>

      <BackupSettings initialConfig={config} initialBackups={backups} dir={BACKUP_DIR} />
    </div>
  );
}
