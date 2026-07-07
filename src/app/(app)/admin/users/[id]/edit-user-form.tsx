"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { DistrictOption } from "@/lib/admin/districts";
import {
  deleteUser,
  updateUser,
  type UserFormState,
} from "@/lib/admin/user-actions";
import { UserFields, type UserInitial } from "../user-fields";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function EditUserForm({
  userId,
  initial,
  districts,
  isSelf,
}: {
  userId: number;
  initial: UserInitial;
  districts: DistrictOption[];
  isSelf: boolean;
}) {
  const [state, action] = useActionState<UserFormState, FormData>(
    updateUser.bind(null, userId),
    undefined,
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-4">
        <UserFields districts={districts} initial={initial} passwordRequired={false} />

        {state?.error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
          >
            {state.error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <SaveButton />
          <Link
            href="/admin/users"
            className="text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </Link>
        </div>
      </form>

      {!isSelf && (
        <form
          action={deleteUser.bind(null, userId)}
          onSubmit={(e) => {
            if (!confirm("Delete this user? This can't be undone.")) e.preventDefault();
          }}
          className="border-t border-slate-200 pt-4 dark:border-slate-800"
        >
          <button
            type="submit"
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Delete user
          </button>
        </form>
      )}
    </div>
  );
}
