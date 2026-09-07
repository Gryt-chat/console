# Gryt console

Where Gryt's outages get announced. Post here and the words appear on
[status.gryt.chat](https://status.gryt.chat) and in a banner in every signed-in
Gryt client.

React and [`@gryt/ui`](https://www.npmjs.com/package/@gryt/ui), served by a
dependency-free Node process that writes one file.

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

## Deploying

Push to `main`. CI builds and pushes `ghcr.io/gryt-chat/console:latest`, and the
VPS pulls it:

```bash
ssh vps 'cd /opt/gryt-status && docker compose pull console && docker compose up -d console'
```

The compose file lives in the `gryt` superproject at `ops/internal/status/`,
next to the Gatus service it shares a config directory with.

## Serving under a path

The tunnel routes `status.gryt.chat/console` here and forwards the whole path,
so every URL the app emits has to resolve under that prefix. Vite builds asset
URLs relative, and the server injects a matching `<base href>` per request — so
the same build works at `/console` and at `/` without being told which.

Anything absolute would leave the mount and land on the status page instead.
That has already happened twice: once with form actions, once with the
stylesheet link.
