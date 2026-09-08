import { Alert, Button, Card, CardContent, CardHeader, Chip, Spinner, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { type AccessView, type Address, ban, getAccess, unban, unlock } from "../api";
import { ago, until, when } from "../lib/time";

/**
 * Who has been trying the password.
 *
 * The console is one password on the open internet, so this is the panel that
 * says whether that is currently a problem. It is also the only way to see a
 * lockout at all: everything else about them happens silently, which is right
 * for the person locked out and useless for the person wondering why.
 */
export function Access() {
  const [view, setView] = useState<AccessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newIp, setNewIp] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    getAccess()
      .then(setView)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(reload, [reload]);

  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    const failed = await work();
    setBusy(false);
    setError(failed);
    if (!failed) reload();
  }

  if (error && !view) return <Alert severity="error">{error}</Alert>;
  if (!view) return <Spinner size={18} />;

  const { limits } = view;

  return (
    <div className="stack">
      <Card>
        <CardHeader
          title="Sign-in attempts"
          subheader={
            `${limits.threshold} wrong passwords within ${limits.windowMinutes} minutes locks an ` +
            `address out for ${limits.firstLockoutMinutes} minutes. Each lockout after that is ` +
            `twice as long, up to ${limits.maxLockoutHours} hours.`
          }
        />
        <CardContent>
          {error ? <Alert severity="error">{error}</Alert> : null}

          {view.addresses.length === 0 ? (
            <p className="muted">
              Nobody has got the password wrong recently. Nothing to see here is the
              right answer for this panel.
            </p>
          ) : (
            <div className="rows">
              {view.addresses.map((a) => (
                <AddressRow key={a.ip} address={a} busy={busy} run={run} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Banned addresses"
          subheader="A ban never expires and is never lifted on its own. One address at a time — no ranges."
        />
        <CardContent>
          <div className="stack">
            {view.bans.length === 0 ? (
              <p className="muted">Nothing is banned.</p>
            ) : (
              <div className="rows">
                {view.bans.map((b) => (
                  <div key={b.ip} className="row">
                    <code className="ip">{b.ip}</code>
                    <span className="row-note">{b.note || "no note"}</span>
                    <span className="row-when" title={when(new Date(b.at).toISOString())}>
                      banned {ago(b.at)}
                    </span>
                    <Button
                      size="xsmall"
                      tone="neutral"
                      disabled={busy}
                      onClick={() => run(() => unban(b.ip))}
                    >
                      Lift
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <form
              className="ban-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const failed = await ban(newIp.trim(), note.trim());
                  if (!failed) {
                    setNewIp("");
                    setNote("");
                  }
                  return failed;
                });
              }}
            >
              <TextField
                placeholder="203.0.113.7"
                required
                value={newIp}
                onChange={(e) => setNewIp(e.currentTarget.value)}
              />
              <TextField
                placeholder="Why (optional)"
                value={note}
                onChange={(e) => setNote(e.currentTarget.value)}
              />
              <Button type="submit" disabled={busy || !newIp.trim()}>
                Ban
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AddressRow({
  address,
  busy,
  run,
}: {
  address: Address;
  busy: boolean;
  run: (work: () => Promise<string | null>) => void;
}) {
  return (
    <div className={address.lockedUntil ? "row locked" : "row"}>
      <code className="ip">{address.ip}</code>

      <div className="row-tags">
        {address.banned ? <Chip label="Banned" tone="danger" /> : null}
        {address.lockedUntil ? (
          <Chip label={`Locked ${until(address.lockedUntil)} more`} tone="warning" />
        ) : null}
        {address.failures > 0 ? (
          <Chip label={`${address.failures} failed`} tone="neutral" />
        ) : null}
        {address.lockouts > 0 ? (
          <Chip
            label={`${address.lockouts} lockout${address.lockouts === 1 ? "" : "s"}`}
            tone="neutral"
          />
        ) : null}
      </div>

      <span className="row-when">last tried {ago(address.lastSeen)}</span>

      <div className="row-actions">
        {address.lockedUntil ? (
          <Button
            size="xsmall"
            tone="neutral"
            disabled={busy}
            onClick={() => run(() => unlock(address.ip))}
          >
            Unlock
          </Button>
        ) : null}
        {!address.banned ? (
          <Button size="xsmall" tone="neutral" disabled={busy} onClick={() => run(() => ban(address.ip, ""))}>
            Ban
          </Button>
        ) : (
          <Button size="xsmall" tone="neutral" disabled={busy} onClick={() => run(() => unban(address.ip))}>
            Lift ban
          </Button>
        )}
      </div>
    </div>
  );
}
