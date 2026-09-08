/**
 * The announcements file, which is the part of this that can lose data.
 *
 * Gatus reads its config from a directory and merges every `*.yaml` in it,
 * appending arrays. So writing `announcements.yaml` beside `config.yaml` adds
 * announcements without touching the config, and Gatus reloads on its own —
 * nothing restarts, and a bad write here cannot take the status page down by
 * corrupting a config it also needs.
 *
 * Kept apart from the routes because this is the piece worth being careful
 * about. Everything else in the server can be rerun; this cannot.
 */

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TYPES = ["outage", "warning", "information", "operational"];

export function fileIn(dir) {
  return join(dir, "announcements.yaml");
}

export function read(dir) {
  const file = fileIn(dir);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8")).announcements ?? [];
  } catch {
    // A file that will not parse reads as no announcements rather than as an
    // error. The alternative is the console refusing to work during the outage
    // it exists to describe.
    return [];
  }
}

/**
 * Written as JSON, which is valid YAML.
 *
 * Building YAML by hand would mean quoting and escaping a message somebody
 * typed, and getting that wrong writes a config that stops Gatus.
 * `JSON.stringify` already handles it.
 */
export function write(dir, list) {
  const file = fileIn(dir);
  const body = JSON.stringify({ announcements: list }, null, 2) + "\n";

  /* Kept so a bad write can be undone by hand without reconstructing it. */
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);

  /* Written then renamed, because Gatus watches this directory and would
     otherwise reload a half-written file. */
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, file);
}

/** The one the client would show: live, and not the all-clear. */
export function current(list) {
  const live = list.filter((a) => !a.archived && a.type !== "operational");
  return live[live.length - 1] ?? null;
}

/**
 * Posting archives whatever came before it.
 *
 * Gatus shows every announcement it is given, so without this the page grows a
 * pile of stale ones. Archived rather than deleted, so the page keeps the
 * history of an incident that got updated three times.
 */
export function posted(list, message, type, now) {
  return [
    ...list.map((a) => ({ ...a, archived: true })),
    { timestamp: new Date(now).toISOString(), type, message },
  ];
}

export function resolved(list, now) {
  return [
    ...list.map((a) => ({ ...a, archived: true })),
    {
      timestamp: new Date(now).toISOString(),
      type: "operational",
      message: "Resolved. Everything is back to normal.",
    },
  ];
}
