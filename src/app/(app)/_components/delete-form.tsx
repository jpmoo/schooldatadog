"use client";

/** A delete <form> that asks for confirmation before running its server action. */
export function DeleteForm({
  action,
  id,
  confirmText,
  label = "Delete",
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: number;
  confirmText: string;
  label?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        {label}
      </button>
    </form>
  );
}
