/**
 * Who may try the password, and who may not.
 *
 * The console is a password on the open internet, so the password is not the
 * whole of the defence — it is the last part of it. This is the part in front:
 * count failures per address, lock an address out once it has enough of them,
 * make each further lockout longer, and keep a list of addresses that never get
 * another try.
 *
 * All of it is pure. State goes in, state comes out, `now` is a parameter, and
 * nothing here reads a clock, a file or a socket. The reason is that this is
 * the piece worth being sure about, and being sure about it should not require
 * a browser, a container or waiting fifteen minutes.
 *
 * ## What it does not do
 *
 * No CIDR ranges, no country blocks, no reputation lists. One address at a
 * time, which is what somebody staring at a list of failed attempts can
 * actually reason about. A botnet spread across a thousand addresses defeats
 * this, and the answer to that is a long generated password rather than a
 * cleverer ban list.
 *
 * ## Addresses come from Cloudflare
 *
 * The container binds loopback and is reached only through the tunnel, so
 * `cf-connecting-ip` is set by Cloudflare and cannot be forged by the client.
 * If this is ever exposed directly, that header becomes attacker-controlled and
 * every count here becomes meaningless.
 */

/** Failures older than this stop counting towards a lockout. */
export const WINDOW_MS = 15 * 60_000;

/** Failures inside the window before an address is locked out. */
export const THRESHOLD = 5;

/** The first lockout. Each one after it doubles. */
export const FIRST_LOCKOUT_MS = 15 * 60_000;

/**
 * The longest a lockout gets.
 *
 * A day rather than forever, because the address that locks itself out is
 * usually Sivert on a phone with the wrong password, and a permanent lockout
 * for that is a support problem with nobody to call. Anything genuinely
 * hostile gets banned by hand, which is permanent.
 */
export const MAX_LOCKOUT_MS = 24 * 3600_000;

/** How long an address is remembered after it goes quiet. */
export const KEEP_MS = 7 * 24 * 3600_000;

/** How many recent failures are kept per address, for the Access panel. */
const KEEP_FAILURES = 20;

export function emptyState() {
  return { ips: {}, bans: {} };
}

/**
 * Accept whatever was on disk, including nothing and including rubbish.
 *
 * A corrupt file must not stop the console from starting. It is a lockout
 * ledger, not the announcements — losing it costs an attacker's counter going
 * back to zero, and refusing to boot over it costs the ability to say the site
 * is down.
 */
export function normalise(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== "object") return state;

  for (const [ip, entry] of Object.entries(raw.ips ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    state.ips[ip] = {
      failures: Array.isArray(entry.failures) ? entry.failures.filter(Number.isFinite) : [],
      lockouts: Number.isFinite(entry.lockouts) ? entry.lockouts : 0,
      lockedUntil: Number.isFinite(entry.lockedUntil) ? entry.lockedUntil : 0,
      lastSeen: Number.isFinite(entry.lastSeen) ? entry.lastSeen : 0,
    };
  }

  for (const [ip, ban] of Object.entries(raw.bans ?? {})) {
    if (!ban || typeof ban !== "object") continue;
    state.bans[ip] = {
      at: Number.isFinite(ban.at) ? ban.at : 0,
      note: typeof ban.note === "string" ? ban.note : "",
    };
  }

  return state;
}

function entryFor(state, ip) {
  return (state.ips[ip] ??= { failures: [], lockouts: 0, lockedUntil: 0, lastSeen: 0 });
}

/**
 * Why this address cannot try, or null if it can.
 *
 * A ban is checked first and reported separately, because "you are banned" and
 * "wait eleven minutes" are different facts and only one of them ends.
 */
export function refusal(state, ip, now) {
  if (state.bans[ip]) return { kind: "banned" };

  const entry = state.ips[ip];
  if (entry && entry.lockedUntil > now) {
    return { kind: "locked", until: entry.lockedUntil, msLeft: entry.lockedUntil - now };
  }

  return null;
}

/**
 * A wrong password.
 *
 * Returns the lockout it caused, or null if there is still room to try. The
 * failure list is trimmed to the window first, so five failures spread over an
 * afternoon never add up to a lockout — that is somebody bad at typing, not
 * somebody guessing.
 */
export function recordFailure(state, ip, now) {
  const entry = entryFor(state, ip);
  entry.lastSeen = now;
  entry.failures = [...entry.failures, now].filter((t) => now - t < WINDOW_MS).slice(-KEEP_FAILURES);

  if (entry.failures.length < THRESHOLD) return null;

  entry.lockouts += 1;
  entry.failures = [];

  const ms = Math.min(FIRST_LOCKOUT_MS * 2 ** (entry.lockouts - 1), MAX_LOCKOUT_MS);
  entry.lockedUntil = now + ms;

  return { until: entry.lockedUntil, ms, lockouts: entry.lockouts };
}

/**
 * The right password.
 *
 * Clears the failures and the lockout but **keeps the count of past lockouts**,
 * so an address that has been locked out three times gets the fourth lockout
 * straight away rather than starting again from fifteen minutes. Guessing until
 * you get in should not reset the ratchet.
 */
export function recordSuccess(state, ip, now) {
  const entry = entryFor(state, ip);
  entry.failures = [];
  entry.lockedUntil = 0;
  entry.lastSeen = now;
}

export function ban(state, ip, note, now) {
  state.bans[ip] = { at: now, note: String(note ?? "").slice(0, 200) };
}

export function unban(state, ip) {
  delete state.bans[ip];
}

/** Clears a lockout without forgiving the ratchet, for a mistake of your own. */
export function unlock(state, ip) {
  const entry = state.ips[ip];
  if (!entry) return;
  entry.failures = [];
  entry.lockedUntil = 0;
}

/**
 * Forget addresses that have gone quiet.
 *
 * Without this the map only grows, and the thing that makes it grow is exactly
 * the thing this module exists for: somebody working through a list of
 * addresses. A ledger that runs the container out of memory is a denial of
 * service with extra steps.
 *
 * A locked-out or banned address is never pruned, however quiet it has been.
 */
export function prune(state, now) {
  for (const [ip, entry] of Object.entries(state.ips)) {
    if (state.bans[ip]) continue;
    if (entry.lockedUntil > now) continue;
    if (now - entry.lastSeen > KEEP_MS) delete state.ips[ip];
  }
  return state;
}

/** What the Access panel draws. Sorted so the loudest address is first. */
export function summary(state, now) {
  const addresses = Object.entries(state.ips)
    .map(([ip, entry]) => ({
      ip,
      failures: entry.failures.filter((t) => now - t < WINDOW_MS).length,
      recent: entry.failures.slice(-5),
      lockouts: entry.lockouts,
      lockedUntil: entry.lockedUntil > now ? entry.lockedUntil : null,
      lastSeen: entry.lastSeen,
      banned: Boolean(state.bans[ip]),
    }))
    .filter((a) => a.failures > 0 || a.lockedUntil || a.lockouts > 0)
    .sort((a, b) => (b.lockedUntil ?? 0) - (a.lockedUntil ?? 0) || b.lastSeen - a.lastSeen);

  const bans = Object.entries(state.bans)
    .map(([ip, ban]) => ({ ip, at: ban.at, note: ban.note }))
    .sort((a, b) => b.at - a.at);

  return { addresses, bans, lockedOut: addresses.filter((a) => a.lockedUntil).length };
}
