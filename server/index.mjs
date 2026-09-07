#!/usr/bin/env node
/**
 * Posts announcements to the status page.
 *
 * Writes announcements.yaml into the directory Gatus already reads. Gatus
 * merges every *.yaml in that directory and appends arrays, so this file adds
 * to config.yaml without touching it, and Gatus reloads on its own.
 *
 * Runs on the VPS next to Gatus, not at home with the site: everything the
 * status page describes is served from home through one Cloudflare tunnel, so a
 * console there is unreachable at the moment it is needed.
 *
 * Password only, deliberately. The obvious alternative is Keycloak, which runs
 * on the machine most likely to be down when somebody needs to post here.
 */

import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, renameSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_DIR = process.env.CONSOLE_CONFIG_DIR || "/config";
const FILE = join(CONFIG_DIR, "announcements.yaml");
const PORT = Number(process.env.PORT || 3002);
const PASSWORD_HASH = process.env.CONSOLE_PASSWORD_HASH || "";

const SESSION_HOURS = 12;
const MAX_MESSAGE = 240;
const TYPES = ["outage", "warning", "information", "operational"];

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

/* One machine posts here. A fixed lockout after a handful of tries costs
   nothing and takes offline guessing off the table. */
const attempts = new Map();
function throttled(ip) {
  const a = attempts.get(ip);
  return a && a.count >= 5 && Date.now() - a.at < 15 * 60_000;
}
function recordFailure(ip) {
  const a = attempts.get(ip) ?? { count: 0, at: 0 };
  attempts.set(ip, { count: a.count + 1, at: Date.now() });
}

/* ── The file ─────────────────────────────────────────────────────────── */

function readAnnouncements() {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf8")).announcements ?? [];
  } catch {
    return [];
  }
}

/**
 * Written as JSON, which is valid YAML.
 *
 * Building YAML by hand would mean quoting and escaping a message somebody
 * typed, and getting that wrong writes a config that stops Gatus. JSON.stringify
 * already handles it.
 */
function writeAnnouncements(list) {
  const body = JSON.stringify({ announcements: list }, null, 2) + "\n";

  /* Kept so a bad write can be undone by hand without reconstructing it. */
  if (existsSync(FILE)) copyFileSync(FILE, `${FILE}.bak`);

  /* Written then renamed, because Gatus watches this directory and would
     otherwise reload a half-written file. */
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, FILE);
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
 * The tunnel mounts this under /console and forwards the whole path, so the
 * app's own asset and API URLs have to resolve under that prefix. Vite builds
 * them relative; this tells the browser what they are relative to.
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

/** The announcement the client would show: live, and not the all-clear. */
function currentAnnouncement() {
  const live = readAnnouncements().filter((a) => !a.archived && a.type !== "operational");
  return live[live.length - 1] ?? null;
}

createServer(async (req, res) => {
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

  if (req.method === "GET" && action === "state") {
    return json(res, 200, {
      signedIn: session,
      announcement: session ? currentAnnouncement() : null,
    });
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }

  const input = await body(req);

  if (action === "login") {
    if (throttled(ip)) {
      return json(res, 429, { error: "Too many attempts. Wait 15 minutes." });
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

    if (!verifyPassword(String(input.password ?? ""))) {
      recordFailure(ip);
      return json(res, 401, { error: "Wrong password." });
    }

    attempts.delete(ip);
    const cookie = `session=${issueSession()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
    return json(res, 200, { signedIn: true, announcement: currentAnnouncement() }, cookie);
  }

  if (!session) return json(res, 401, { error: "Sign in first." });

  if (action === "announce") {
    const message = String(input.message ?? "").trim().slice(0, MAX_MESSAGE);
    if (!message) return json(res, 400, { error: "Say what is wrong." });

    const type = TYPES.includes(input.type) ? input.type : "outage";

    /* Everything already up is archived rather than dropped, so the status
       page keeps the history of an incident that got updated. */
    const list = readAnnouncements().map((a) => ({ ...a, archived: true }));
    list.push({ timestamp: new Date().toISOString(), type, message });
    writeAnnouncements(list);

    return json(res, 200, { signedIn: true, announcement: currentAnnouncement() });
  }

  if (action === "resolve") {
    /* `operational` is Gatus's all-clear, and the client skips it — so this
       closes the incident on the page and stops the banner in one write. */
    const list = readAnnouncements().map((a) => ({ ...a, archived: true }));
    list.push({
      timestamp: new Date().toISOString(),
      type: "operational",
      message: "Resolved. Everything is back to normal.",
    });
    writeAnnouncements(list);

    return json(res, 200, { signedIn: true, announcement: null });
  }

  return json(res, 404, { error: "No such thing." });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`status console on :${PORT}, writing ${FILE}`);
  if (!PASSWORD_HASH) console.warn("CONSOLE_PASSWORD_HASH is not set — nobody can sign in.");
  else if (!parseHash())
    console.warn(
      `CONSOLE_PASSWORD_HASH is malformed (${PASSWORD_HASH.length} chars) — nobody can sign in. ` +
        "If it contains $, Docker Compose ate it; re-run hash-password for a colon-delimited one.",
    );
});
