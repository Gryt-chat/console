import { Alert, Card, CardContent, CardHeader, Chip, Spinner } from "@gryt/ui";
import { useEffect, useState } from "react";

import { type Announcement, getHistory } from "../api";
import { look } from "../lib/severity";
import { ago, when } from "../lib/time";

/**
 * Everything that has been posted, newest first.
 *
 * Posting archives what came before it rather than deleting it, so this is the
 * whole record — including the three rewordings of one incident, which is
 * usually what somebody is trying to reconstruct afterwards.
 */
export function History() {
  const [list, setList] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHistory()
      .then((d) => setList(d.announcements))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <Card>
      <CardHeader title="History" subheader="Every announcement, newest first." />
      <CardContent>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {list === null && !error ? <Spinner size={18} /> : null}

        {list?.length === 0 ? (
          <p className="muted">Nothing has been announced yet.</p>
        ) : null}

        <div className="log">
          {list?.map((a, i) => {
            const l = look(a.type);
            return (
              <article key={`${a.timestamp}-${i}`} className="entry">
                <span className="entry-dot" style={{ background: l.dot }} aria-hidden="true" />
                <div className="entry-body">
                  <div className="entry-head">
                    <Chip label={l.label} tone={l.chip} />
                    {!a.archived ? <Chip label="Live" tone="primary" /> : null}
                    <span className="entry-when" title={when(a.timestamp)}>
                      {ago(a.timestamp)}
                    </span>
                  </div>
                  <p className="entry-message">{a.message}</p>
                  <span className="entry-exact">{when(a.timestamp)}</span>
                </div>
              </article>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
