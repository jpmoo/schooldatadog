"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { DistrictOption } from "@/lib/admin/districts";
import { createUser, type UserFormState } from "@/lib/admin/user-actions";
import { UserFields } from "./user-fields";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create user"}
    </button>
  );
}

export function CreateUserForm({ districts }: { districts: DistrictOption[] }) {
  const [state, action] = useActionState<UserFormState, FormData>(
    createUser,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a successful create.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <UserFields districts={districts} passwordRequired />

      {state?.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          User created.
        </p>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
