import { Alert, Button, Card, CardContent, CardHeader, Select, Spinner, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import { announce, getState, resolve, signIn, type Severity, type State } from "./api";

const SEVERITIES = [
  { label: "Outage", value: "outage" },
  { label: "Warning", value: "warning" },
  { label: "Information", value: "information" },
];

/** UTC and spelled out, because the server's clock is not the reader's. */
function when(iso: string): string {
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

function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const failed = await signIn(password);
    setBusy(false);
    if (failed) setError(failed);
    else onDone();
  }

  return (
    <Card>
      <CardHeader title="Sign in" subheader="The password is in Bitwarden." />
      <CardContent>
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            type="password"
            placeholder="Password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner size={16} /> : null} Sign in
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Announce({ state, reload }: { state: State; reload: () => void }) {
  const [message, setMessage] = useState("");
  const [type, setType] = useState<Severity>("outage");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = state.announcement;

  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    const failed = await work();
    setBusy(false);
    setError(failed);
    if (!failed) {
      setMessage("");
      reload();
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card>
        <CardHeader
          title="Announcement"
          subheader="Everyone signed in sees this until you resolve it."
        />
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => announce(message, type));
            }}
            style={{ display: "grid", gap: 12 }}
          >
            {error ? <Alert severity="error">{error}</Alert> : null}

            {live ? (
              <Alert severity="error">
                <strong>Live now.</strong> {live.message}
                <span style={{ display: "block", opacity: 0.75, fontSize: 12, marginTop: 3 }}>
                  Posted {when(live.timestamp)}
                </span>
              </Alert>
            ) : (
              <Alert severity="info">Nothing announced. No banner is showing in the client.</Alert>
            )}

            <TextField
              multiline
              minRows={3}
              maxLength={240}
              required
              placeholder="An issue has appeared and we are investigating it."
              value={message}
              onChange={(e) => setMessage(e.currentTarget.value)}
            />
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Select
                  options={SEVERITIES}
                  value={type}
                  onValueChange={(v: unknown) => setType(String(v) as Severity)}
                />
              </div>
              <Button type="submit" disabled={busy || !message.trim()}>
                Post
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {live ? (
        <Card>
          <CardHeader
            title="Resolve"
            subheader="Marks it over on the status page and stops the banner."
          />
          <CardContent>
            <Button tone="neutral" disabled={busy} onClick={() => run(resolve)}>
              Post the all-clear
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function App() {
  const [state, setState] = useState<State | null>(null);

  const reload = () => {
    getState()
      .then(setState)
      .catch(() => setState({ signedIn: false, announcement: null }));
  };

  useEffect(reload, []);

  return (
    <main style={{ maxWidth: 620, margin: "0 auto", padding: "40px 20px 64px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "var(--gryt-radius-full)",
            background: "var(--gryt-accent-9)",
          }}
        />
        <h1 style={{ fontSize: 19, fontWeight: 650, margin: 0, letterSpacing: "-0.01em" }}>
          Status console
        </h1>
      </header>
      <p
        style={{
          color: "var(--gryt-neutral-11)",
          fontSize: 13.5,
          margin: "4px 0 26px 42px",
        }}
      >
        Posts to status.gryt.chat and to every signed-in Gryt client.
      </p>

      {state === null ? (
        <Spinner size={20} />
      ) : state.signedIn ? (
        <Announce state={state} reload={reload} />
      ) : (
        <SignIn onDone={reload} />
      )}
    </main>
  );
}
