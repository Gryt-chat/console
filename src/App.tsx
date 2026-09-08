import { Alert, Button, Card, CardContent, CardHeader, Spinner, Tabs, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { getOverview, type Overview as OverviewData, signIn } from "./api";
import { Access } from "./panels/Access";
import { History } from "./panels/History";
import { Overview } from "./panels/Overview";

/** How often the overview refreshes itself while somebody is watching it. */
const REFRESH_MS = 30_000;

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
    <div className="signin">
      <Card>
        <CardHeader title="Sign in" subheader="The password is in Bitwarden." />
        <CardContent>
          <form onSubmit={submit} className="stack">
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
    </div>
  );
}

/**
 * The one line at the top that says whether anything is wrong.
 *
 * Above the tabs, because it is the answer to the question somebody opened this
 * page with, and it should not depend on which tab they happen to be on.
 */
function Headline({ data }: { data: OverviewData }) {
  const down = data.services.filter((s) => s.up === false);

  if (data.servicesError) {
    return <span className="headline unknown">Gatus did not answer</span>;
  }
  if (down.length > 0) {
    return (
      <span className="headline bad">
        {down.length} {down.length === 1 ? "service" : "services"} down
      </span>
    );
  }
  if (data.services.length === 0) {
    return <span className="headline unknown">Checking</span>;
  }
  return <span className="headline good">All {data.services.length} checks passing</span>;
}

export function App() {
  const [data, setData] = useState<OverviewData | null>(null);

  const reload = useCallback(() => {
    getOverview()
      .then(setData)
      .catch(() =>
        setData({ signedIn: false, announcement: null, services: [], servicesError: null }),
      );
  }, []);

  useEffect(reload, [reload]);

  /* Refreshed on a timer because this page is left open during an incident, and
     a dashboard that needs reloading to tell you anything new is a screenshot. */
  useEffect(() => {
    if (!data?.signedIn) return;
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [data?.signedIn, reload]);

  if (data === null) {
    return (
      <main className="console">
        <Spinner size={20} />
      </main>
    );
  }

  if (!data.signedIn) {
    return (
      <main className="console">
        <Header data={null} />
        <SignIn onDone={reload} />
      </main>
    );
  }

  return (
    <main className="console">
      <Header data={data} />

      <Tabs defaultValue="overview">
        <Tabs.List className="tabs">
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="history">History</Tabs.Tab>
          <Tabs.Tab value="access">Access</Tabs.Tab>
          <Tabs.Indicator />
        </Tabs.List>

        <Tabs.Panel value="overview" className="panel">
          <Overview data={data} reload={reload} />
        </Tabs.Panel>
        <Tabs.Panel value="history" className="panel">
          <History />
        </Tabs.Panel>
        <Tabs.Panel value="access" className="panel">
          <Access />
        </Tabs.Panel>
      </Tabs>
    </main>
  );
}

function Header({ data }: { data: OverviewData | null }) {
  return (
    <header className="top">
      <div className="mark" aria-hidden="true" />
      <div className="title">
        <h1>Gryt console</h1>
        <p>Posts to status.gryt.chat and to every signed-in Gryt client.</p>
      </div>
      {data ? <Headline data={data} /> : null}
    </header>
  );
}
