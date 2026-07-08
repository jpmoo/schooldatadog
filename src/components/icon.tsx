import type { CSSProperties } from "react";

export type IconName =
  | "apply"
  | "calcualtedField"
  | "clear"
  | "dashboard"
  | "dataWorkshop"
  | "delete"
  | "export"
  | "logout"
  | "myDistrictSchools"
  | "open"
  | "rename"
  | "saveViewOrGroup"
  | "savedItems"
  | "Settings"
  | "spec"
  | "showHideEmpty"
  | "showHidePanel"
  | "user"
  | "visualizer";

/**
 * A monochrome icon rendered as a CSS mask filled with `currentColor` (see
 * .icon in globals.css). Each icon's URL is a CSS var set in the root layout so
 * it carries basePath. Size with `className` (e.g. "h-5 w-5"); `flip` mirrors it
 * horizontally (used for the panel toggle).
 */
export function Icon({
  name,
  className = "h-5 w-5",
  flip = false,
}: {
  name: IconName;
  className?: string;
  flip?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`icon ${flip ? "-scale-x-100" : ""} ${className}`}
      style={{ "--icon": `var(--i-${name})` } as CSSProperties}
    />
  );
}
