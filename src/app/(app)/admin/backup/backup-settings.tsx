"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeBackup, runBackupNow, saveBackupSchedule } from "@/lib/backup/actions";
import {
  WEEKDAY_NAMES,
  describeSchedule,
  type BackupConfig,
} from "@/lib/backup/config";
import type { BackupFile } from "@/lib/backup/run";

const pad = (n: number) => String(n).padStart(2, "0");

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}

const field =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

export function BackupSettings({
  initialConfig,
  initialBackups,
  dir,
}: {
  initialConfig: BackupConfig;
  initialBackups: BackupFile[];
  dir: string;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<BackupConfig>(initialConfig);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [backingUp, startBackup] = useTransition();
  const [deleting, setDeleting] = useState<string | null>(null);

  const set = (patch: Partial<BackupConfig>) => {
    setSavedMsg(null);
    setCfg((c) => ({ ...c, ...patch }));
  };

  function save() {
    setSavedMsg(null);
    startSave(async () => {
      const res = await saveBackupSchedule(cfg);
      setSavedMsg(res.ok ? "Saved." : res.error);
    });
  }

  function backupNow() {
    setBackupMsg(null);
    startBackup(async () => {
      const res = await runBackupNow();
      if (res.ok) {
        setBackupMsg({ ok: true, text: `Backed up — ${res.file} (${fmtBytes(res.bytes)}).` });
        router.refresh();
      } else {
        setBackupMsg({ ok: false, text: res.error });
      }
    });
  }

  async function del(name: string) {
    if (!confirm(`Delete backup ${name}? This can't be undone.`)) return;
    setDeleting(name);
    const res = await removeBackup(name);
    setDeleting(null);
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Run on demand */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">Back up now</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Write a fresh backup immediately, then prune to the retention limit below.
            </p>
          </div>
          <button
            type="button"
            onClick={backupNow}
            disabled={backingUp}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {backingUp ? "Backing up…" : "Back up now"}
          </button>
        </div>
        {backupMsg && (
          <p
            className={`mt-3 text-sm ${
              backupMsg.ok
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {backupMsg.text}
          </p>
        )}
      </section>

      {/* Schedule */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-semibold text-slate-900 dark:text-white">Automatic backups</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {describeSchedule(cfg)} Times use the server&apos;s local time.
        </p>

        <label className="mt-4 flex items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
          />
          Run backups on a schedule
        </label>

        <div className={`mt-4 grid gap-4 sm:grid-cols-2 ${cfg.enabled ? "" : "opacity-50"}`}>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Frequency</span>
            <select
              value={cfg.frequency}
              disabled={!cfg.enabled}
              onChange={(e) => set({ frequency: e.target.value as BackupConfig["frequency"] })}
              className={field}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>

          {cfg.frequency === "weekly" && (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Day of week</span>
              <select
                value={cfg.weekday}
                disabled={!cfg.enabled}
                onChange={(e) => set({ weekday: Number(e.target.value) })}
                className={field}
              >
                {WEEKDAY_NAMES.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">Time</span>
            <input
              type="time"
              value={`${pad(cfg.hour)}:${pad(cfg.minute)}`}
              disabled={!cfg.enabled}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                if (Number.isFinite(h) && Number.isFinite(m)) set({ hour: h, minute: m });
              }}
              className={field}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Keep this many backups
            </span>
            <input
              type="number"
              min={1}
              max={365}
              value={cfg.retention}
              onChange={(e) => set({ retention: Math.max(1, Number(e.target.value) || 1) })}
              className={field}
            />
            <span className="text-xs text-slate-400">
              Older backups beyond this count are deleted after each run.
            </span>
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save schedule"}
          </button>
          {savedMsg && (
            <span
              className={`text-sm ${
                savedMsg === "Saved."
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {savedMsg}
            </span>
          )}
        </div>
      </section>

      {/* Existing backups */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="font-semibold text-slate-900 dark:text-white">
          Saved backups {initialBackups.length > 0 && `(${initialBackups.length})`}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Stored in <code className="break-all text-xs">{dir}</code>. Restore a{" "}
          <code className="text-xs">.dump</code> with{" "}
          <code className="text-xs">pg_restore</code>.
        </p>

        {initialBackups.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No backups yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {initialBackups.map((b) => (
              <li key={b.name} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-slate-800 dark:text-slate-200">
                    {b.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(b.createdAt).toLocaleString()} · {fmtBytes(b.bytes)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => del(b.name)}
                  disabled={deleting === b.name}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                >
                  {deleting === b.name ? "Deleting…" : "Delete"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
