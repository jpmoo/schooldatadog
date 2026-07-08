"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { changeMyPassword } from "@/lib/account/actions";

type AccountUser = { name: string | null; email: string; role: string; homeDistrict?: string | null };

export function AccountMenu({ user }: { user: AccountUser }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        title="Account settings"
      >
        <Icon name="user" className="h-4 w-4" />
        {user.name || user.email}
      </button>
      {open && <AccountModal user={user} onClose={() => setOpen(false)} />}
    </>
  );
}

function AccountModal({ user, onClose }: { user: AccountUser; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setMsg(null);
    if (next.length < 8) {
      setMsg({ ok: false, text: "New password must be at least 8 characters." });
      return;
    }
    if (next !== confirm) {
      setMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    setSaving(true);
    const res = await changeMyPassword(current, next);
    setSaving(false);
    if (res.ok) {
      setMsg({ ok: true, text: "Password updated." });
      setCurrent("");
      setNext("");
      setConfirm("");
    } else {
      setMsg({ ok: false, text: res.error });
    }
  }

  const field =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
          <Icon name="user" className="h-5 w-5 text-indigo-500" />
          Account
        </h2>

        <dl className="mt-4 space-y-2 text-sm">
          {user.name && (
            <div className="flex justify-between gap-4">
              <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <Icon name="user" className="h-4 w-4" /> Name
              </dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">{user.name}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500 dark:text-slate-400">Email</dt>
            <dd className="font-medium text-slate-800 dark:text-slate-100">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500 dark:text-slate-400">Role</dt>
            <dd className="font-medium capitalize text-slate-800 dark:text-slate-100">{user.role}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <Icon name="myDistrictSchools" className="h-4 w-4" /> Home district
            </dt>
            <dd className="font-medium text-slate-800 dark:text-slate-100">
              {user.homeDistrict || <span className="font-normal text-slate-400">Not set (an admin can set this)</span>}
            </dd>
          </div>
        </dl>

        <h3 className="mt-6 text-sm font-semibold text-slate-700 dark:text-slate-200">Change password</h3>
        <div className="mt-2 flex flex-col gap-2">
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            className={field}
          />
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="New password (min 8 characters)"
            className={field}
          />
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            className={field}
          />
        </div>
        {msg && (
          <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {msg.text}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Icon name="no" className="h-4 w-4" />
            Close
          </button>
          <button
            onClick={submit}
            disabled={saving || !current || !next || !confirm}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            <Icon name="saveViewOrGroup" className="h-4 w-4" />
            {saving ? "Updating…" : "Update password"}
          </button>
        </div>
      </div>
    </div>
  );
}
