"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AuthState } from "@/lib/auth/actions";

type Mode = "login" | "signup";

type Props = {
  mode: Mode;
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
};

function SubmitButton({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60"
    >
      {pending
        ? "Please wait…"
        : mode === "login"
          ? "Sign in"
          : "Create account"}
    </button>
  );
}

export function AuthForm({ mode, action }: Props) {
  const [state, formAction] = useActionState<AuthState, FormData>(
    action,
    undefined,
  );
  const isSignup = mode === "signup";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isSignup && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Name <span className="text-slate-400">(optional)</span>
          </span>
          <input
            name="name"
            type="text"
            autoComplete="name"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          Password
        </span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={isSignup ? "new-password" : "current-password"}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
        {isSignup && (
          <span className="text-xs text-slate-400">
            At least 8 characters.
          </span>
        )}
      </label>

      {state?.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {state.error}
        </p>
      )}

      <SubmitButton mode={mode} />

      <p className="text-center text-sm text-slate-500 dark:text-slate-400">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-indigo-600 hover:underline"
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            Need an account?{" "}
            <Link
              href="/signup"
              className="font-medium text-indigo-600 hover:underline"
            >
              Create one
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
