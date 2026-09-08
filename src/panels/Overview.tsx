import { Alert, Button, Card, CardContent, CardHeader, Chip, Select, Spinner, TextField } from "@gryt/ui";
import { useState } from "react";

import { announce, type Overview as OverviewData, resolve, type Service } from "../api";
import { look, POSTABLE, type Severity } from "../lib/severity";
import { ago, when } from "../lib/time";

/**
 * A strip of the last twenty checks, oldest on the left.
 *
 * Twenty bars rather than a number, because "up" and "up, with four blips in
 * the last hour" are different things and only one of them is worth getting out
 * of bed for. Gatus draws the same idea on the public page; this is the same
 * data before it leaves the building.
 */
function History({ history }: { history: boolean[] }) {
  return (
    <div className="strip" aria-hidden="true">
      {history.map((ok, i) => (
        <span key={i} className={ok ? "tick up" : "tick down"} />
      ))}
    </div>
  );
}

function ServiceRow({ service }: { service: Service }) {
  const down = service.up === false;

  return (
    <div className={down ? "service down" : "service"}>
      <span className={down ? "dot down" : "dot up"} aria-hidden="true" />

      <div className="service-name">
        <span>{service.name}</span>
        {down && service.failing.length > 0 ? (
          <span className="service-why">{service.failing.join(", ")}</span>
        ) : null}
      </div>

      <History history={service.history} />

      <span className="service-latency">{service.ms === null ? "—" : `${service.ms} ms`}</span>
      <span className="service-when">{ago(service.at)}</span>
    </div>
  );
}

function Services({ services, error }: { services: Service[]; error: string | null }) {
  if (error) {
    return (
      <Alert severity="warning">
        Gatus could not be asked, so this is not a claim that everything is fine:{" "}
        {error}
      </Alert>
    );
  }

  if (services.length === 0) return <Spinner size={18} />;

  /* Grouped the way Gatus groups them, so this page and the public one describe
     the same shape of the world. */
  const groups = [...new Set(services.map((s) => s.group))];

  return (
    <div className="groups">
      {groups.map((group) => (
        <section key={group}>
          <h3 className="group-name">{group}</h3>
          <div className="group-rows">
            {services
              .filter((s) => s.group === group)
              .map((s) => (
                <ServiceRow key={s.key} service={s} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function Overview({ data, reload }: { data: OverviewData; reload: () => void }) {
  const [message, setMessage] = useState("");
  const [type, setType] = useState<Severity>("outage");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = data.announcement;
  const liveLook = look(live?.type);

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
    <div className="stack">
      <Card>
        <CardHeader
          title="Announcement"
          subheader="Shown on status.gryt.chat and to everyone signed in to Gryt."
        />
        <CardContent>
          <div className="stack">
            {error ? <Alert severity="error">{error}</Alert> : null}

            {live ? (
              <Alert severity={liveLook.alert}>
                <div className="live">
                  <Chip label={liveLook.label} tone={liveLook.chip} />
                  <span>{live.message}</span>
                </div>
                <span className="live-when">
                  Posted {when(live.timestamp)} · {ago(live.timestamp)}
                </span>
              </Alert>
            ) : (
              <Alert severity="success">
                Nothing announced. No banner is showing in the client.
              </Alert>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => announce(message, type));
              }}
              className="stack"
            >
              <TextField
                multiline
                minRows={3}
                maxLength={240}
                required
                placeholder="An issue has appeared and we are investigating it."
                value={message}
                onChange={(e) => setMessage(e.currentTarget.value)}
              />

              <div className="post-row">
                {/* Wrapped because Select is w-full, and a full-width severity
                    picker pushes the buttons onto their own line. */}
                <div className="post-type">
                  <Select
                    options={POSTABLE.map((value) => ({ label: look(value).label, value }))}
                    value={type}
                    onValueChange={(v: unknown) => setType(String(v) as Severity)}
                  />
                </div>
                <span className="count">{message.length}/240</span>
                <div className="post-actions">
                  {live ? (
                    <Button tone="neutral" disabled={busy} onClick={() => run(resolve)} type="button">
                      Post the all-clear
                    </Button>
                  ) : null}
                  <Button type="submit" disabled={busy || !message.trim()}>
                    {live ? "Replace it" : "Post"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Services"
          subheader="What Gatus saw on its last run of each check."
        />
        <CardContent>
          <Services services={data.services} error={data.servicesError} />
        </CardContent>
      </Card>
    </div>
  );
}
