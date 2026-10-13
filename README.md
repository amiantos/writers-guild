# Writers Guild

AI-powered short story writing application that supports Tavern character cards and SillyTavern lorebooks.

[![codecov](https://codecov.io/github/amiantos/writers-guild/graph/badge.svg?token=QRDTDEUZ6X)](https://codecov.io/github/amiantos/writers-guild)

## Features

- **Interactive Story Writing** - Pick one or multiple characters, optionally assign a character as your persona, and go on an adventure with them
- **Character Card Support** - Import Tavern V2 character cards from PNG or CHUB (or create one from scratch)
- **Full Lorebook Support** - Import SillyTavern lorebooks with fully featured activation engine
- **ST Macro Support** - Supports ST macros like `{{random:a,b,c}}` and `{{pick:x,y,z}}`
- **Generation Control** - Continue the story from a specific character's perspective; open-ended generation based on story context; or request specific events to occur.
- **Chats (experimental)** - Text with one or more of your characters, in a scenario you describe, with any provider. Turn it on under Experimental Features in Settings; its prompts are customizable in each preset.
- **Users (optional)** - Turn on signing in to password-protect your Writers Guild, then invite other people by link, each with a private library of their own.

## Motivations

After years of using SillyTavern, I realized the character cards I enjoyed interacting with the most were very prose-like, and I started to suspect that the "chat" oriented nature of SillyTavern was actually preventing LLMs from fulfilling their potential as interactive story writers, and likely causing a lot of common issues (like repetitive messages, low creativity, etc).

So I decided to make Writers Guild, which uses the same character cards and lorebooks as SillyTavern, but uses them to write in a format more akin to a short story or novel. Writers Guild also attempts to enforce a consistent perspective (third) and tense (past), which is something a lot of character card authors struggle with, so it has a button to automatically rewrite the original greeting from the character into a consistent style (the most useful feature, imho).

## Quick Start

### Local Development (Recommended)

Requires Node.js 24 (the current LTS); CI and the Docker image both run 24.

**Run both server and client with one command:**

```bash
# Install dependencies (first time only)
npm install
npm install --prefix server
npm install --prefix vue_client

# Start both server and client
npm run dev
```

This will start:

- **Server** on http://localhost:8000 (API)
- **Vue Client** on http://localhost:5173 (Dev UI with hot-reload)

Open http://localhost:5173 in your browser.

**Access from another device (phone, tablet):**

By default both dev servers listen on localhost only. To expose them to your
local network instead:

```bash
npm run dev:lan
```

Then open `http://<your-machine-ip>:5173` on the other device. Only do this on
a network you trust — the API serves your stories and your configured provider
API keys. To require a password, turn on signing in (see
[Users and signing in](#users-and-signing-in)).

Docker and `npm run server:start` are unaffected — they keep binding all
interfaces per `server/config.yaml`. `HOST` overrides that value when set.

**Or run separately:**

```bash
# Terminal 1 - Server
cd server
npm install
npm run dev

# Terminal 2 - Vue Client
cd vue_client
npm install
npm run dev
```

### Docker (Production)

Each release is published as a multi-arch (amd64/arm64) image at
`ghcr.io/amiantos/writers-guild`. Download the compose file and start it:

```bash
curl -O https://raw.githubusercontent.com/amiantos/writers-guild/main/docker-compose.yml
docker compose up -d
```

Writers Guild is then on http://localhost:8000, with all of its data in `./data` next to the
compose file. To update to the latest release: `docker compose pull && docker compose up -d`.

To require a password, turn on signing in (see [Users and signing in](#users-and-signing-in)). For
a reverse-proxy network or building the image from a checkout, copy
`docker-compose.override.yml.example` to `docker-compose.override.yml` and edit it.

Image tags: `latest` and `X.Y.Z` / `X.Y` follow releases; `staging` follows `main`.

### Users and signing in

Out of the box Writers Guild has no accounts: anyone who can reach it uses it, as its admin. To
password-protect it, open **Settings → Account → Turn On Signing In** and choose a username and
password. From then on:

- Everyone signs in. Sessions last 30 days in that browser.
- Under **Settings → Users** you can invite people. There's no signing up: each invitation is a
  link that makes one account and works for 7 days. Send it to them, and they choose a username and
  password.
- Each person's library is their own: stories, chats, characters, lorebooks, Continuities, presets
  (API keys included) and settings. A new user starts at onboarding, like a fresh install. Nobody,
  the admin included, can see anyone else's.
- The admin can give a user a link to reset their password, or delete their account along with
  everything in it.
- Signing in can be turned off again only when the admin is the only user.

If you forget the admin's password, make a reset link from the server, then open the path it
prints on your Writers Guild:

```bash
npm run reset-password                                                # from a checkout
docker compose exec writers-guild node scripts/reset-password.js     # with Docker
```

Pass a username to reset someone else's. Behind a proxy that ends TLS, have it send
`X-Forwarded-Proto: https` so the session cookie is marked `Secure`.

If you used `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` before there were users, the first start
turns signing in on with them: the admin signs in with the same username and password, and the
browser's basic auth prompt goes away. You can then remove them from `.env`. This happens once, so
turning signing in off later isn't undone by a restart; with it off and the variables still set,
basic auth guards Writers Guild again. Scripts that called the API with basic auth (`curl -u`) need
a session instead once signing in is on.

## Setup

1. Open http://localhost:5173 (dev) or http://localhost:8000 (Docker)
2. Navigate to Settings and add your DeepSeek API key
3. Import character cards and lorebooks
4. Start writing!

## Project Structure

```
writers-guild/
├── server/           # Node.js/Express API server
├── vue_client/       # Vue 3 frontend application
├── data/            # User data (stories, characters, lorebooks)
└── docker-compose.yml
```

## Development

- **Server**: Node.js with Express, serves API and static files
- **Client**: Vue 3 with Vue Router and Vite
- **Hot Reload**: Both server and client support hot-reload in dev mode

## Releases

Writers Guild follows [Semantic Versioning](https://semver.org/), and each release's changes are in
its [GitHub release notes](https://github.com/amiantos/writers-guild/releases). To cut a release:

1. Set the version everywhere it's recorded (the root, server, and client `package.json` files and
   their lockfiles): `npm run version:set 1.1.0`, then commit and merge.
2. Tag the merged commit (`git tag v1.1.0 && git push origin v1.1.0`) and publish a GitHub release
   from the tag, with the release's changes as its notes.

The version shows at the bottom of Settings and in the server's startup banner.

## Android Build

better-sqlite3 and sharp publish no prebuilt binaries for Android, and neither compiles itself on
install, so on Android (e.g. Termux) build them from source after installing the server's
dependencies (this uses the `node-addon-api` and `node-gyp` dev dependencies):

```bash
cd server
npm install
npm explore better-sqlite3 -- npm run build-release
npm explore sharp -- npm run build
```

## API

The server runs on port 8000 and provides:

- `/api/stories` - Story management
- `/api/characters` - Character library
- `/api/lorebooks` - Lorebook management
- `/api/settings` - User settings
- `/api/chats` - Chats and their messages (experimental)
- `/api/auth` - Signing in and out, and invitation and password reset links
- `/api/users` - Users and invitations (admin only)
- `/` - Serves the Vue client (production) or forwards to Vite (dev)

## Community & Discussion

- Discuss Writers Guild [on Libera.Chat IRC](https://web.libera.chat/#writers-guild) in #writers-guild
- Or, in [The Eye of Providence Discord](https://discord.gg/rpSKvGp2uY) in #writers-guild
