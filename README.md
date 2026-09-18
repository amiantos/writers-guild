# Writers Guild

AI-powered short story writing application that supports Tavern character cards and SillyTavern lorebooks.

[![codecov](https://codecov.io/github/amiantos/writers-guild/graph/badge.svg?token=QRDTDEUZ6X)](https://codecov.io/github/amiantos/writers-guild)

## Features

- **Interactive Story Writing** - Pick one or multiple characters, optionally assign a character as your persona, and go on an adventure with them
- **Character Card Support** - Import Tavern V2 character cards from PNG or CHUB (or create one from scratch)
- **Full Lorebook Support** - Import SillyTavern lorebooks with fully featured activation engine
- **ST Macro Support** - Supports ST macros like `{{random:a,b,c}}` and `{{pick:x,y,z}}`
- **Generation Control** - Continue the story from a specific character's perspective; open-ended generation based on story context; or request specific events to occur.
- **Bureau (experimental)** - Write an ongoing story, chapter by chapter, with characters who remember, change over time, and can be messaged between chapters. See [Bureau](#bureau-experimental).

## Motivations

After years of using SillyTavern, I realized the character cards I enjoyed interacting with the most were very prose-like, and I started to suspect that the "chat" oriented nature of SillyTavern was actually preventing LLMs from fulfilling their potential as interactive story writers, and likely causing a lot of common issues (like repetitive messages, low creativity, etc).

So I decided to make Writers Guild, which uses the same character cards and lorebooks as SillyTavern, but uses them to write in a format more akin to a short story or novel. Writers Guild also attempts to enforce a consistent perspective (third) and tense (past), which is something a lot of character card authors struggle with, so it has a button to automatically rewrite the original greeting from the character into a consistent style (the most useful feature, imho).

## Bureau (experimental)

Bureau is a separate mode for an ongoing story with living characters, written in chapters. Each Bureau has a cast, a world of attached lorebooks, an ordered series of chapters, and one clock: Bureau time, a story clock that only you move. Any year from 1 to 9999 works.

- **Story mode's writing, with memory** - A Writer writes each passage with story mode's prompts (Continue, Continue for Character, and Continue with Instruction as Direct), adding what the characters remember, established facts, and the chapter's time, and an Archivist commits what happened to memory. Every step is recorded and shows in the seam between turns.
- **Memory** - Characters remember what they know, what happened from their point of view, and how they've changed. Every memory shows its source and can be edited, and a chapter only remembers what came before its start.
- **Character development** - Changes to a character are proposed for your review, and nothing rewrites their card on its own.
- **Profiles and interviews** - Read and edit a cast member's profile, the Bureau's copy of their card plus their routine, from the cast list, a chapter, or their messages. An interview asks you about them one question at a time, then writes your answers up as a new description, personality, and routine for you to review, with a line for the profile of anyone they turn out to have a relationship with. Every version of a profile is kept.
- **Messages** - Write to cast members between chapters. Messages happen at Bureau time, and "Time passes" moves the clock forward when you want, between messages or within a chapter. Replies know their memories, their routine, and the time of day, and conversations become memories too. When time jumps forward, characters get a short account of what they did meanwhile.
- **Character generator** - Generate characters from an idea, from a Bureau's cast section or from "Who's in this chapter" while you write.
- **Greetings, images, and avatars** - As in story mode, open a chapter with a greeting from a character's card, rewritten by the Writer in third person, see the images that cards and lorebooks carry, and float character avatars over the page.

Bureau keeps its data in `data/bureau.db`, apart from story mode. Bureaus share one DeepSeek API key unless one has its own, and use DeepSeek V4.1 Flash by default. The Bureaus tab explains the terms the first time you open it, and the full design is in [docs/bureau-design.md](docs/bureau-design.md).

## Quick Start

### Local Development (Recommended)

**Run both server and client with one command:**

```bash
# Install dependencies (first time only)
npm install
cd server && npm install && cd ..
cd vue_client && npm install && cd ..

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
API keys. If you want a password prompt in front of it, you can optionally set
`BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` in `.env` (see `.env.example`).

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

```bash
docker-compose up -d
```

This builds the Vue client and serves it from the Node.js server on http://localhost:8000.

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

## Android Build

- To build natively in Android you need `node-addon-api` and `node-gyp`

## API

The server runs on port 8000 and provides:

- `/api/stories` - Story management
- `/api/characters` - Character library
- `/api/lorebooks` - Lorebook management
- `/api/settings` - User settings
- `/api/bureaus` - Bureaus, their cast, stories, messages, and memories (experimental)
- `/` - Serves the Vue client (production) or forwards to Vite (dev)

## Community & Discussion

- Discuss Writers Guild [on Libera.Chat IRC](https://web.libera.chat/#writers-guild) in #writers-guild
- Or, in [The Eye of Providence Discord](https://discord.gg/rpSKvGp2uY) in #writers-guild
