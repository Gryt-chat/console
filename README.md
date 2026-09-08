# Gryt console

Where Gryt's outages get announced, and where you find out whether anything is
wrong in the first place. Post here and the words appear on
[status.gryt.chat](https://status.gryt.chat) and in a banner in every signed-in
Gryt client.

React and [`@gryt/ui`](https://www.npmjs.com/package/@gryt/ui), served by a
dependency-free Node process.

Three panels:

| | |
|---|---|
| **Overview** | The announcement that is live, the form to post one, and what Gatus saw on its last run of every check — up or down, latency, and a strip of the last twenty results. |
| **History** | Every announcement, newest first. Posting archives what came before rather than deleting it, so this is the whole record of an incident including its rewordings. |
| **Access** | Who has been getting the password wrong, who is locked out, and the ban list. |

## How it reaches people

The status page runs [Gatus](https://github.com/TwiN/gatus), which supports
announcements — it calls them incident communications. Gatus merges every
`*.yaml` in its config directory and appends arrays, so this writes
`announcements.yaml` beside `config.yaml`, never touches it, and Gatus reloads
on its own. No restart.

The Gryt client polls `status.gryt.chat/api/v1/config` and shows a banner to
anybody signed in. Posting once puts the same words in both places, so the page
and the banner cannot disagree.

**Resolve** archives what is up and posts an `operational` notice. That closes
the incident on the page and stops the banner in one write, because the client
skips the all-clear.

## Where it runs, and why not with everything else

On the VPS, next to Gatus.

Gryt's servers, Keycloak and the identity service are at Sivert's house, behind
one Cloudflare tunnel, and so is the website. A console there would be
unreachable at the exact moment somebody needs to announce that they are down.
That is the same reason the status page is not at home either.

## Running it

```bash
npm install
npm run dev            # the app, proxying /api to the server below
npm run serve          # the API, on :3002
```

`npm run dev` needs `CONSOLE_PASSWORD_HASH` set for the server, and a
`CONSOLE_CONFIG_DIR` pointing somewhere writable so it does not try `/config`:

```bash
CONSOLE_CONFIG_DIR=/tmp/gatus-config \
CONSOLE_PASSWORD_HASH="$(printf '%s' 'a-long-enough-dev-password' | npm run --silent hash-password)" \
npm run serve
```

## The password

One password, hashed with scrypt, in an env var on the VPS. Sivert keeps it in
Bitwarden.

```bash
printf '%s' 'the-password' | npm run --silent hash-password
```

Put the output in `/opt/gryt-status/.env` as `CONSOLE_PASSWORD_HASH`.

**The separator is a colon, not `$`.** Docker Compose interpolates `$` in a
`.env` value, so a `$`-delimited hash arrives with the salt and hash substituted
away as undefined variables — every password wrong, and nothing saying why. It
refuses to hash anything under 16 characters, and the session key is derived
from the hash, so changing the password ends every open session.

Keycloak was the obvious alternative and it runs on the machine most likely to
be down when somebody needs to post here.

## One password on the open internet

Which is why there is a lockout ledger. `server/access.mjs` counts failures per
address, locks an address out after five wrong passwords within fifteen minutes,
and doubles the lockout each time it happens again, up to a day. A ban is
separate: it never expires and is only lifted by hand.

It survives a restart. That is the point — an in-memory lockout is defeated by
whatever restarts the container, and a container that restarts on a crash is
exactly what somebody guessing gets to provoke. The ledger is JSON on the
`console-data` volume at `/data/access.json`, kept out of `/config` because
Gatus merges every `*.yaml` there into its own configuration.

Addresses come from `cf-connecting-ip`. The container binds loopback and is only
reached through the tunnel, so Cloudflare sets that header and a client cannot
forge it. Exposing this port directly would make every count in the ledger
meaningless.

`access.mjs` takes `now` as a parameter and touches nothing else, so
`npm test` asserts on a lockout expiring without waiting fifteen minutes for it.
CI runs those before it builds anything.

A thousand addresses trying once each defeats all of this. The answer to that is
the generated password being long, not a cleverer ban list.

## Deploying

Push to `main`. CI builds and pushes `ghcr.io/gryt-chat/console:latest`, and the
VPS pulls it:

```bash
ssh vps 'cd /opt/gryt-status && docker compose pull console && docker compose up -d console'
```

The compose file lives in the `gryt` superproject at `ops/internal/status/`,
next to the Gatus service it shares a config directory with. It mounts two
things: `./config` from the host, shared with Gatus, and the `console-data`
volume for the lockout ledger.

## Serving under a path

It lives at [console.gryt.chat](https://console.gryt.chat) now, at the root. It
was at `status.gryt.chat/console` first, which is a path nobody can remember at
the moment they need it.

The prefix support stayed. Vite builds asset URLs relative, and the server
injects a matching `<base href>` per request, so the same build works at `/`
and under any path without being told which.

Anything absolute would leave the mount and land on the status page instead.
That has already happened twice: once with form actions, once with the
stylesheet link.
