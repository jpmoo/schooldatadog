import "server-only";

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { logActivity } from "@/lib/activity/log";
import { getBackupConfig } from "@/lib/settings";

const run = promisify(execFile);

/**
 * Where backups live: a `backup/` folder in the app's working directory. Under
 * `next start` the cwd is always the project root (it's where `.next` lives), so
 * this resolves to <app>/backup. The folder is git-ignored.
 */
export const BACKUP_DIR = path.join(process.cwd(), "backup");

const PREFIX = "schooldatadog-";
const EXT = ".dump";
// Matches only files this tool creates, so delete/prune can never touch anything
// else that happens to be in the folder.
const NAME_RE = /^schooldatadog-\d{8}-\d{6}\.dump$/;

export type BackupResult =
  | { ok: true; file: string; bytes: number }
  | { ok: false; error: string };

export type BackupFile = { name: string; bytes: number; createdAt: number };

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * Dump the whole database to a compressed pg_dump custom-format file, then prune
 * old backups down to the configured retention count. Best-effort logging.
 */
export async function performBackup(userId: number | null): Promise<BackupResult> {
  const url = process.env.DATABASE_URL;
  if (!url) return { ok: false, error: "DATABASE_URL is not set on the server." };

  const pgDump = process.env.PG_DUMP_PATH || "pg_dump";
  const name = `${PREFIX}${stamp(new Date())}${EXT}`;
  const filePath = path.join(BACKUP_DIR, name);

  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    // -Fc = custom compressed format (restore with pg_restore). Passing the
    // connection URI via --dbname keeps credentials out of argv-visible flags.
    await run(pgDump, ["-Fc", "--no-owner", "--no-privileges", "--dbname", url, "-f", filePath], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const { size } = await fs.stat(filePath);

    await pruneBackups();
    await logActivity(userId, "backup.create", "backup", name);
    return { ok: true, file: name, bytes: size };
  } catch (err) {
    // Clean up a half-written file so it doesn't masquerade as a good backup.
    await fs.rm(filePath, { force: true }).catch(() => {});
    const code = (err as { code?: unknown })?.code;
    const stderr = String((err as { stderr?: unknown })?.stderr ?? "").trim();
    const message =
      code === "ENOENT"
        ? `Couldn't run "${pgDump}". Install the PostgreSQL client tools, or set PG_DUMP_PATH to the pg_dump binary.`
        : stderr || (err instanceof Error ? err.message : "Backup failed.");
    await logActivity(userId, "backup.error", "backup", message.slice(0, 255));
    return { ok: false, error: message };
  }
}

/** Existing backup files, newest first. */
export async function listBackups(): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(BACKUP_DIR);
  } catch {
    return []; // folder not created yet
  }
  const files = await Promise.all(
    names
      .filter((n) => NAME_RE.test(n))
      .map(async (name) => {
        const { size, mtimeMs } = await fs.stat(path.join(BACKUP_DIR, name));
        return { name, bytes: size, createdAt: Math.round(mtimeMs) };
      }),
  );
  return files.sort((a, b) => b.createdAt - a.createdAt);
}

/** Delete backups beyond the configured retention count (keep the newest N). */
export async function pruneBackups(): Promise<void> {
  const { retention } = await getBackupConfig();
  const files = await listBackups();
  for (const f of files.slice(retention)) {
    await fs.rm(path.join(BACKUP_DIR, f.name), { force: true }).catch(() => {});
  }
}

/** Delete one backup by name. Rejects anything that isn't a backup filename. */
export async function deleteBackup(name: string): Promise<boolean> {
  if (!NAME_RE.test(name)) return false;
  try {
    await fs.rm(path.join(BACKUP_DIR, name), { force: true });
    return true;
  } catch {
    return false;
  }
}
