/**
 * The API, addressed relative to wherever the app is mounted.
 *
 * It is at console.gryt.chat now, at the root, and it was under a path first.
 * The server injects a `<base href>` per request, so a relative path resolves
 * either way. An absolute "/api/…" would leave a mount and hit whatever else
 * is on that hostname.
 */
const url = (path: string) => new URL(`api/${path}`, document.baseURI).toString();

import type { Severity } from "./lib/severity";

export type { Severity };

export interface Announcement {
  message: string;
  type: string;
  timestamp: string;
  archived?: boolean;
}

export interface State {
  signedIn: boolean;
  announcement: Announcement | null;
}

/** One endpoint as Gatus last saw it, trimmed to what the panel draws. */
export interface Service {
  name: string;
  group: string;
  key: string;
  up: boolean | null;
  status: number | null;
  ms: number | null;
  at: string | null;
  /** The conditions that failed, when it is down. Empty when it is up. */
  failing: string[];
  /** Oldest to newest, so the strip reads left to right. */
  history: boolean[];
}

export interface Overview extends State {
  services: Service[];
  /** Set when Gatus could not be asked, so the grid can say why it is empty. */
  servicesError: string | null;
}

export interface Address {
  ip: string;
  failures: number;
  recent: number[];
  lockouts: number;
  lockedUntil: number | null;
  lastSeen: number;
  banned: boolean;
}

export interface Ban {
  ip: string;
  at: number;
  note: string;
}

export interface AccessView {
  addresses: Address[];
  bans: Ban[];
  lockedOut: number;
  limits: {
    threshold: number;
    windowMinutes: number;
    firstLockoutMinutes: number;
    maxLockoutHours: number;
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(url(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The message rather than a boolean, so the reason can be shown as written. */
async function reason(res: Response, fallback: string): Promise<string | null> {
  if (res.ok) return null;
  const { error } = await res.json().catch(() => ({ error: fallback }));
  return error ?? fallback;
}

export const getState = () => get<State>("state");
export const getOverview = () => get<Overview>("overview");
export const getHistory = () => get<{ announcements: Announcement[] }>("history");
export const getAccess = () => get<AccessView>("access");

export async function signIn(password: string): Promise<string | null> {
  return reason(await post("login", { password }), "Could not sign in.");
}

export async function announce(message: string, type: Severity): Promise<string | null> {
  return reason(await post("announce", { message, type }), "Could not post.");
}

export async function resolve(): Promise<string | null> {
  return reason(await post("resolve", {}), "Could not resolve.");
}

export async function ban(ip: string, note: string): Promise<string | null> {
  return reason(await post("ban", { ip, note }), "Could not ban.");
}

export async function unban(ip: string): Promise<string | null> {
  return reason(await post("unban", { ip }), "Could not lift the ban.");
}

export async function unlock(ip: string): Promise<string | null> {
  return reason(await post("unlock", { ip }), "Could not unlock.");
}
