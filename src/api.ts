/**
 * The API, addressed relative to wherever the app is mounted.
 *
 * The tunnel serves this at /console, and the server injects a matching
 * <base href>, so a relative path resolves under it. An absolute "/api/…"
 * would leave the mount and hit the status page instead.
 */
const url = (path: string) => new URL(`api/${path}`, document.baseURI).toString();

export type Severity = "outage" | "warning" | "information";

export interface Announcement {
  message: string;
  type: string;
  timestamp: string;
}

export interface State {
  signedIn: boolean;
  announcement: Announcement | null;
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(url(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function getState(): Promise<State> {
  const res = await fetch(url("state"));
  if (!res.ok) throw new Error(`state: ${res.status}`);
  return res.json();
}

/** The message rather than a boolean, so the reason can be shown as written. */
export async function signIn(password: string): Promise<string | null> {
  const res = await post("login", { password });
  if (res.ok) return null;
  const { error } = await res.json().catch(() => ({ error: "Could not sign in." }));
  return error ?? "Could not sign in.";
}

export async function announce(message: string, type: Severity): Promise<string | null> {
  const res = await post("announce", { message, type });
  if (res.ok) return null;
  const { error } = await res.json().catch(() => ({ error: "Could not post." }));
  return error ?? "Could not post.";
}

export async function resolve(): Promise<string | null> {
  const res = await post("resolve");
  if (res.ok) return null;
  const { error } = await res.json().catch(() => ({ error: "Could not resolve." }));
  return error ?? "Could not resolve.";
}
