#!/usr/bin/env node
/**
 * The lockout ledger, checked without a clock.
 *
 * Every function in `access.mjs` takes `now`, which is the whole reason this
 * can assert on a lockout expiring rather than sleeping for fifteen minutes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ban,
  emptyState,
  FIRST_LOCKOUT_MS,
  MAX_LOCKOUT_MS,
  KEEP_MS,
  normalise,
  prune,
  recordFailure,
  recordSuccess,
  refusal,
  summary,
  THRESHOLD,
  unban,
  unlock,
  WINDOW_MS,
} from "./access.mjs";

const IP = "203.0.113.7";
const T0 = 1_700_000_000_000;

test("a few wrong guesses are not a lockout", () => {
  const state = emptyState();
  for (let i = 0; i < THRESHOLD - 1; i++) {
    assert.equal(recordFailure(state, IP, T0 + i * 1000), null);
  }
  assert.equal(refusal(state, IP, T0), null);
});

test("enough wrong guesses inside the window is", () => {
  const state = emptyState();
  let locked = null;
  for (let i = 0; i < THRESHOLD; i++) locked = recordFailure(state, IP, T0 + i * 1000);

  assert.ok(locked, "the last failure should return the lockout it caused");
  assert.equal(locked.ms, FIRST_LOCKOUT_MS);

  const why = refusal(state, IP, T0 + 60_000);
  assert.equal(why.kind, "locked");
  assert.ok(why.msLeft > 0);
});

test("the same failures spread wide never add up", () => {
  const state = emptyState();
  /* One every eleven minutes: five of them, never five inside a fifteen-minute
     window. This is somebody bad at typing, not somebody guessing. */
  for (let i = 0; i < 10; i++) {
    assert.equal(recordFailure(state, IP, T0 + i * 11 * 60_000), null);
  }
  assert.equal(refusal(state, IP, T0 + 10 * 11 * 60_000), null);
});

test("a lockout ends on its own", () => {
  const state = emptyState();
  let locked = null;
  for (let i = 0; i < THRESHOLD; i++) locked = recordFailure(state, IP, T0 + i * 1000);

  /* Timed from the failure that caused it, not from the first one. */
  assert.ok(refusal(state, IP, locked.until - 1));
  assert.equal(refusal(state, IP, locked.until + 1), null);
});

test("each lockout is twice the last, up to a cap", () => {
  const state = emptyState();
  const lengths = [];

  for (let round = 0; round < 12; round++) {
    const start = T0 + round * MAX_LOCKOUT_MS * 2;
    let locked = null;
    for (let i = 0; i < THRESHOLD; i++) locked = recordFailure(state, IP, start + i * 1000);
    lengths.push(locked.ms);
  }

  assert.equal(lengths[0], FIRST_LOCKOUT_MS);
  assert.equal(lengths[1], FIRST_LOCKOUT_MS * 2);
  assert.equal(lengths[2], FIRST_LOCKOUT_MS * 4);
  assert.equal(lengths.at(-1), MAX_LOCKOUT_MS, "and it stops there");
  assert.ok(lengths.every((ms) => ms <= MAX_LOCKOUT_MS));
});

test("getting in clears the lockout but not the ratchet", () => {
  const state = emptyState();
  for (let i = 0; i < THRESHOLD; i++) recordFailure(state, IP, T0 + i * 1000);
  recordSuccess(state, IP, T0 + 2000);

  assert.equal(refusal(state, IP, T0 + 3000), null, "signed in, so not locked out");

  let again = null;
  for (let i = 0; i < THRESHOLD; i++) again = recordFailure(state, IP, T0 + 10_000 + i * 1000);
  assert.equal(again.ms, FIRST_LOCKOUT_MS * 2, "the second lockout is still the second one");
});

test("a ban outranks everything and does not expire", () => {
  const state = emptyState();
  ban(state, IP, "was guessing all night", T0);

  assert.equal(refusal(state, IP, T0).kind, "banned");
  assert.equal(refusal(state, IP, T0 + 365 * 24 * 3600_000).kind, "banned");

  unban(state, IP);
  assert.equal(refusal(state, IP, T0), null);
});

test("unlock forgives the wait, not the count", () => {
  const state = emptyState();
  for (let i = 0; i < THRESHOLD; i++) recordFailure(state, IP, T0 + i * 1000);
  unlock(state, IP);

  assert.equal(refusal(state, IP, T0 + 2000), null);
  assert.equal(state.ips[IP].lockouts, 1);
});

test("quiet addresses are forgotten, loud ones are not", () => {
  const state = emptyState();
  recordFailure(state, "198.51.100.1", T0);
  for (let i = 0; i < THRESHOLD; i++) recordFailure(state, "198.51.100.2", T0 + i * 1000);
  ban(state, "198.51.100.3", "", T0);
  recordFailure(state, "198.51.100.3", T0);

  const later = T0 + KEEP_MS + 1000;
  prune(state, later);

  assert.equal(state.ips["198.51.100.1"], undefined, "quiet, so forgotten");
  assert.ok(state.ips["198.51.100.3"], "banned, so kept whatever it does");

  /* The locked-out one is kept while the lockout runs and dropped after, which
     is the same rule, not an exception to it. */
  prune(state, T0 + 1000);
  assert.ok(state.ips["198.51.100.2"]);
});

test("a corrupt ledger loads as an empty one", () => {
  assert.deepEqual(normalise(null), emptyState());
  assert.deepEqual(normalise("nonsense"), emptyState());
  assert.deepEqual(normalise({ ips: "no" }), emptyState());

  const half = normalise({
    ips: { [IP]: { failures: [1, "x", 3], lockouts: "many", lastSeen: 5 } },
    bans: { "198.51.100.9": { at: 1, note: 7 } },
  });
  assert.deepEqual(half.ips[IP].failures, [1, 3], "junk timestamps dropped");
  assert.equal(half.ips[IP].lockouts, 0, "a non-number counts as none");
  assert.equal(half.bans["198.51.100.9"].note, "", "a non-string note is no note");
});

test("the summary shows what is worth looking at", () => {
  const state = emptyState();
  recordFailure(state, "198.51.100.1", T0);
  for (let i = 0; i < THRESHOLD; i++) recordFailure(state, "198.51.100.2", T0 + i * 1000);
  ban(state, "198.51.100.3", "obvious", T0);

  const now = T0 + 60_000;
  const view = summary(state, now);

  assert.equal(view.lockedOut, 1);
  assert.equal(view.addresses[0].ip, "198.51.100.2", "the locked-out one is first");
  assert.equal(view.bans[0].ip, "198.51.100.3");

  /* An address whose failures have aged out of the window and never earned a
     lockout is not news, and would otherwise fill the list forever. */
  const quiet = summary(state, T0 + WINDOW_MS * 2);
  assert.ok(!quiet.addresses.some((a) => a.ip === "198.51.100.1"));
});
