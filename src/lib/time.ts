/** UTC and spelled out, because the server's clock is not the reader's. */
export function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC"
  );
}

/**
 * "4 minutes ago", for things that only matter relative to now.
 *
 * Beside the absolute time rather than instead of it: during an incident the
 * question is usually "how long has this been going on", and counting from a
 * timestamp in your head is exactly the thing to get wrong at that moment.
 */
export function ago(at: number | string | null): string {
  if (at === null) return "never";
  const ms = Date.now() - (typeof at === "number" ? at : new Date(at).getTime());
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 60_000) return "just now";

  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;

  return `${Math.round(hours / 24)} d ago`;
}

/** "in 12 minutes", for a lockout that has not finished. */
export function until(at: number): string {
  const minutes = Math.ceil((at - Date.now()) / 60_000);
  if (minutes <= 0) return "any moment";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}
