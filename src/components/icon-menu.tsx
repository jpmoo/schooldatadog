"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/icon";

export type MenuItem = { label: string; onClick: () => void };

/** An icon-only button that opens a small dropdown of actions. */
export function IconMenu({
  icon,
  title,
  items,
  buttonClassName,
  disabled = false,
  align = "right",
}: {
  icon: IconName;
  title: string;
  items: MenuItem[];
  buttonClassName: string;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={buttonClassName}
        title={title}
        aria-haspopup="menu"
      >
        <Icon name={icon} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute ${align === "right" ? "right-0" : "left-0"} z-50 mt-1 w-40 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900`}
          >
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => {
                  it.onClick();
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
