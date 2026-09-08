import type { AlertSeverity } from "@gryt/ui";

/**
 * One place that decides what a severity looks like.
 *
 * It was not one place before, and the bug that came of it was small and
 * obvious the moment anybody used it: the live announcement was drawn as
 * `<Alert severity="error">` whatever it said, so posting an information
 * notice put a red box on the screen. Red is the loudest thing this app can
 * say, and it was saying it about "the servers are moving on Sunday".
 */
export type Severity = "outage" | "warning" | "information" | "operational";

export interface Look {
  label: string;
  /** For Alert, which has its own four names. */
  alert: AlertSeverity;
  /** For Chip, which has six. */
  chip: "danger" | "warning" | "primary" | "success";
  /** The dot beside a row, as a CSS colour. */
  dot: string;
}

export const LOOK: Record<Severity, Look> = {
  outage: {
    label: "Outage",
    alert: "error",
    chip: "danger",
    dot: "var(--gryt-danger-9, #e5484d)",
  },
  warning: {
    label: "Warning",
    alert: "warning",
    chip: "warning",
    dot: "var(--gryt-warning-9, #f5a524)",
  },
  information: {
    label: "Information",
    alert: "info",
    chip: "primary",
    dot: "var(--gryt-accent-9)",
  },
  operational: {
    label: "Resolved",
    alert: "success",
    chip: "success",
    dot: "var(--gryt-success-9, #30a46c)",
  },
};

/** Anything Gatus or an older file might hold, coerced to something drawable. */
export function look(type: string | undefined): Look {
  return LOOK[(type ?? "") as Severity] ?? LOOK.information;
}

/** The three somebody can actually post. `operational` is what Resolve writes. */
export const POSTABLE: Severity[] = ["outage", "warning", "information"];
