#!/usr/bin/env node
/**
 * Gryt's operations console.
 *
 * Posts announcements to the status page, shows what Gatus currently thinks of
 * every Gryt service, and keeps the record of who has been trying the password.
 *
 * Announcements are written as announcements.yaml into the directory Gatus
 * already reads. Gatus merges every *.yaml in that directory and appends
 * arrays, so this file adds to config.yaml without touching it, and Gatus
 * reloads on its own.
 *
 * Runs on the VPS next to Gatus, not at home with the site: everything the
 * status page describes is served from home through one Cloudflare tunnel, so a
 * console there is unreachable at the moment it is needed.
 *
 * Password only, deliberately. The obvious alternative is Keycloak, which runs
 * on the machine most likely to be down when somebody needs to post here. That
 * choice is why `access.mjs` exists.
 */

import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as access from "./access.mjs";
import * as announcements from "./announcements.mjs";

const CONFIG_DIR = process.env.CONSOLE_CONFIG_DIR || "/config";
const DATA_DIR = process.env.CONSOLE_DATA_DIR || "/data";
const PORT = Number(process.env.PORT || 3002);
const PASSWORD_HASH = process.env.CONSOLE_PASSWORD_HASH || "";

/** Reached over the compose network, so the browser never talks to Gatus. */
const GATUS_URL = process.env.CONSOLE_GATUS_URL || "http://gatus:8080";

const SESSION_HOURS = 12;
const MAX_MESSAGE = 240;

/* ── Password ─────────────────────────────────────────────────────────── */

/**
 * `scrypt:<salt base64>:<hash base64>`, as printed by hash-password.mjs.
 *
 * `$` is still accepted because the first version of this used it, but never
 * emitted: Docker Compose interpolates `$` in a .env value, so a $-delimited
 * hash reaches the container with the salt and hash substituted away as
 * undefined variables, and every password is wrong for a reason nothing says
 * out loud.
 */
function parseHash() {
  const parts = PASSWORD_HASH.includes(":")
    ? PASSWORD_HASH.split(":")
    : PASSWORD_HASH.split("$");
  return parts.length === 3 && parts[0] === "scrypt" ? parts : null;
}

function verifyPassword(password) {
  const parts = parseHash();
  if (!parts) return false;

  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = scryptSync(password, salt, expected.length);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* Derived from the password hash so there is one secret to keep, and rotating
   the password invalidates every session for free. */
const SESSION_KEY = createHmac("sha256", PASSWORD_HASH).update("session").digest();

function issueSession() {
  const expires = Date.now() + SESSION_HOURS * 3600_000;
  const sig = createHmac("sha256", SESSION_KEY).update(String(expires)).digest("base64url");
  return `${expires}.${sig}`;
}

function validSession(cookie) {
  const [expires, sig] = String(cookie || "").split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;

  const want = createHmac("sha256", SESSION_KEY).update(expires).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ── The lockout ledger ───────────────────────────────────────────────── */

/**
 * Kept in `/data`, not in `/config`.
 *
 * `/config` is Gatus's, and Gatus merges every `*.yaml` it finds there into its
 * own configuration. Putting console state in that directory means one careless
 * filename away from the status page refusing to start — during, most likely,
 * the outage it was meant to report.
 */
const LEDGER = join(DATA_DIR, "access.json");

function loadLedger() {
  try {
    return access.normalise(JSON.parse(readFileSync(LEDGER, "utf8")));
  } catch {
    // No file yet, or one that will not parse. Either way the answer is an
    // empty ledger: refusing to start over a counter would be worse than
    // losing the counter.
    return access.emptyState();
  }
}

const ledger = loadLedger();

/**
 * Saved on every change, because the thing it protects against is a restart.
 *
 * An in-memory lockout is defeated by whatever restarts the container, and a
 * container that restarts on a crash is exactly what an attacker gets to
 * provoke. The file is a few kilobytes and writes are rare — every one of them
 * is somebody getting the password wrong.
 */
function saveLedger() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${LEDGER}.tmp`;
    writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", "utf8");
    renameSync(tmp, LEDGER);
  } catch (err) {
    // Logged and carried on. The ledger still works in memory; it just will not
    // survive a restart, and saying so is more use than a 500 on the login form.
    console.error("could not save the lockout ledger:", err);
  }
}

/* ── The built app ────────────────────────────────────────────────────── */

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
};

/**
 * index.html with a <base> matching the path it was served at.
 *
 * It is at console.gryt.chat now, at the root, so this is usually `/`. It was
 * under a path first, and the app can still be mounted under one because every
 * URL it emits is relative and this tells the browser what they are relative to.
 */
function indexFor(path) {
  const dir = path.endsWith("/") ? path : `${path}/`;
  return readFileSync(join(DIST, "index.html"), "utf8").replace(
    "<head>",
    `<head><base href="${dir}">`,
  );
}

function serveAsset(res, name) {
  /* Basename only. A built asset never has a path, and this is the one place a
     request string reaches the filesystem. */
  const file = join(DIST, "assets", name.replace(/^.*\//, ""));
  if (!file.startsWith(join(DIST, "assets")) || !existsSync(file)) return false;

  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable",
  });
  res.end(readFileSync(file));
  return true;
}

/* ── HTTP ─────────────────────────────────────────────────────────────── */

function json(res, status, value, cookie) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(status, headers);
  res.end(JSON.stringify(value));
}

function body(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 8192) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const cookieFrom = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)),
  ).session;

/**
 * What Gatus currently thinks of every service.
 *
 * Fetched here rather than in the browser: Gatus is only reachable inside the
 * compose network, and going through this server means the console shows the
 * same view whether or not status.gryt.chat is reachable from where you are
 * sitting — which, during the kind of outage this exists for, it might not be.
 *
 * Only the last few results per endpoint, because the panel draws a strip of
 * recent checks and the full fifty per endpoint is most of a megabyte.
 */
async function services() {
  const res = await fetch(`${GATUS_URL}/api/v1/endpoints/statuses`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Gatus answered ${res.status}`);

  return (await res.json()).map((endpoint) => {
    const recent = (endpoint.results ?? []).slice(-20);
    const last = recent.at(-1) ?? null;

    return {
      name: endpoint.name,
      group: endpoint.group,
      key: endpoint.key,
      up: last?.success ?? null,
      status: last?.status ?? null,
      /* Gatus counts in nanoseconds. Milliseconds are what a person reads. */
      ms: last ? Math.round(last.duration / 1e6) : null,
      at: last?.timestamp ?? null,
      failing: last?.success === false
        ? (last.conditionResults ?? []).filter((c) => !c.success).map((c) => c.condition)
        : [],
      history: recent.map((r) => r.success === true),
    };
  });
}

/* ── Routes ───────────────────────────────────────────────────────────── */

async function handle(req, res) {
  const path = new URL(req.url, "http://x").pathname;
  const ip = req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "?";
  const session = validSession(cookieFrom(req));

  if (path.endsWith("/health")) {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

  if (req.method === "GET" && path.includes("/assets/")) {
    if (serveAsset(res, path)) return;
    res.writeHead(404);
    return res.end();
  }

  if (!path.includes("/api/")) {
    if (req.method !== "GET") {
      res.writeHead(405);
      return res.end();
    }
    /* Everything that is not the API is the app, so a refresh on any path
       still lands somewhere sensible. */
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(indexFor(path));
  }

  const action = path.slice(path.lastIndexOf("/") + 1);
  const now = Date.now();

  if (req.method === "GET" && action === "state") {
    return json(res, 200, {
      signedIn: session,
      announcement: session ? announcements.current(announcements.read(CONFIG_DIR)) : null,
    });
  }

  /* ── Signed out ────────────────────────────────────────────────────── */

  if (req.method === "POST" && action === "login") {
    const why = access.refusal(ledger, ip, now);
    if (why) {
      return json(res, 429, {
        error: why.kind === "banned"
          ? "This address is banned."
          : `Too many attempts. Try again in ${Math.ceil(why.msLeft / 60_000)} minutes.`,
      });
    }

    if (!PASSWORD_HASH) {
      return json(res, 500, { error: "CONSOLE_PASSWORD_HASH is not set on the server." });
    }
    /* Says the hash is broken rather than the password is wrong. The two look
       identical from the form and only one of them is the person's fault. */
    if (!parseHash()) {
      return json(res, 500, {
        error: `CONSOLE_PASSWORD_HASH is malformed (${PASSWORD_HASH.length} chars). Re-run hash-password.`,
      });
    }

    const attempt = await body(req);

    if (!verifyPassword(String(attempt.password ?? ""))) {
      const locked = access.recordFailure(ledger, ip, now);
      access.prune(ledger, now);
      saveLedger();

      return json(res, 401, {
        error: locked
          ? `Wrong password. Locked out for ${Math.round(locked.ms / 60_000)} minutes.`
          : "Wrong password.",
      });
    }

    access.recordSuccess(ledger, ip, now);
    access.prune(ledger, now);
    saveLedger();

    const cookie = `session=${issueSession()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
    return json(
      res,
      200,
      {
        signedIn: true,
        announcement: announcements.current(announcements.read(CONFIG_DIR)),
      },
      cookie,
    );
  }

  if (!session) return json(res, 401, { error: "Sign in first." });

  /* ── Signed in ─────────────────────────────────────────────────────── */

  if (req.method === "GET" && action === "overview") {
    const list = announcements.read(CONFIG_DIR);
    let checked = [];
    let servicesError = null;
    try {
      checked = await services();
    } catch (err) {
      // The panel says so rather than showing an empty grid, which would read
      // as "nothing is being watched" instead of "I could not ask".
      servicesError = err instanceof Error ? err.message : String(err);
    }

    return json(res, 200, {
      signedIn: true,
      announcement: announcements.current(list),
      services: checked,
      servicesError,
    });
  }

  if (req.method === "GET" && action === "history") {
    /* Newest first, which is the order somebody reads an incident log in. */
    return json(res, 200, { announcements: announcements.read(CONFIG_DIR).slice().reverse() });
  }

  if (req.method === "GET" && action === "access") {
    access.prune(ledger, now);
    return json(res, 200, {
      ...access.summary(ledger, now),
      limits: {
        threshold: access.THRESHOLD,
        windowMinutes: access.WINDOW_MS / 60_000,
        firstLockoutMinutes: access.FIRST_LOCKOUT_MS / 60_000,
        maxLockoutHours: access.MAX_LOCKOUT_MS / 3600_000,
      },
    });
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }

  const payload = await body(req);

  /**
   * A write that fails must not take the process with it.
   *
   * It did: an EACCES on the config directory threw out of the handler, Node
   * exited, and the console answered 502 until Docker restarted it. The person
   * posting saw a failed request with no reason, which is the worst outcome for
   * a page whose whole job is explaining an outage.
   */
  const write = (list) => {
    try {
      announcements.write(CONFIG_DIR, list);
      return null;
    } catch (err) {
      console.error("could not write the announcement:", err);
      return err.code === "EACCES"
        ? `Cannot write ${announcements.fileIn(CONFIG_DIR)}. The config directory is not writable by this container.`
        : `Could not write the announcement: ${err.message}`;
    }
  };

  if (action === "announce") {
    const message = String(payload.message ?? "").trim().slice(0, MAX_MESSAGE);
    if (!message) return json(res, 400, { error: "Say what is wrong." });

    const type = announcements.TYPES.includes(payload.type) ? payload.type : "outage";

    const failed = write(announcements.posted(announcements.read(CONFIG_DIR), message, type, now));
    if (failed) return json(res, 500, { error: failed });

    return json(res, 200, {
      signedIn: true,
      announcement: announcements.current(announcements.read(CONFIG_DIR)),
    });
  }

  if (action === "resolve") {
    const failed = write(announcements.resolved(announcements.read(CONFIG_DIR), now));
    if (failed) return json(res, 500, { error: failed });

    return json(res, 200, { signedIn: true, announcement: null });
  }

  if (action === "ban" || action === "unban" || action === "unlock") {
    const target = String(payload.ip ?? "").trim();
    if (!target) return json(res, 400, { error: "Which address?" });

    if (action === "ban") access.ban(ledger, target, payload.note, now);
    if (action === "unban") access.unban(ledger, target);
    if (action === "unlock") access.unlock(ledger, target);

    saveLedger();
    return json(res, 200, { ...access.summary(ledger, now) });
  }

  return json(res, 404, { error: "No such thing." });
}

/**
 * One catch around every request.
 *
 * Node exits on an unhandled rejection, so a throw anywhere in the handler
 * took the whole console down and answered 502 until Docker restarted it. An
 * EACCES writing announcements.yaml did exactly that. A 500 the person can
 * read is a much smaller failure than a process that disappears.
 */
createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(`${req.method} ${req.url} failed:`, err);
    if (res.headersSent) return res.end();
    json(res, 500, { error: "Something went wrong. The container log has it." });
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`status console on :${PORT}`);
  console.log(`  announcements  ${announcements.fileIn(CONFIG_DIR)}`);
  console.log(`  lockout ledger ${LEDGER}`);
  console.log(`  services from  ${GATUS_URL}`);

  /* Said at boot rather than at the first post. The config directory is a bind
     mount, and Docker does not chown those, so a root-owned directory on the
     host leaves this container — which runs as node — unable to write the one
     file it exists to write. It looked like a broken page rather than a
     permission problem, because the throw killed the process. */
  try {
    accessSync(CONFIG_DIR, constants.W_OK);
  } catch {
    console.warn(
      `${CONFIG_DIR} is not writable by uid ${process.getuid?.() ?? "?"} — ` +
        "posting an announcement will fail. chown the directory to this uid on the host.",
    );
  }

  /* Same idea for the ledger, which lives on a named volume rather than a bind
     mount and so is normally fine. Said out loud anyway, because the failure is
     silent and the cost is that a restart forgives every lockout. */
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    accessSync(DATA_DIR, constants.W_OK);
  } catch {
    console.warn(
      `${DATA_DIR} is not writable — lockouts and bans will be kept in memory only, ` +
        "and a restart will clear them. Mount a volume there.",
    );
  }

  if (!PASSWORD_HASH) console.warn("CONSOLE_PASSWORD_HASH is not set — nobody can sign in.");
  else if (!parseHash())
    console.warn(
      `CONSOLE_PASSWORD_HASH is malformed (${PASSWORD_HASH.length} chars) — nobody can sign in. ` +
        "If it contains $, Docker Compose ate it; re-run hash-password for a colon-delimited one.",
    );
});
