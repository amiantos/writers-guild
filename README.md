# Writers Guild

AI-powered short story writing application that supports Tavern character cards and SillyTavern lorebooks.

[![codecov](https://codecov.io/github/amiantos/writers-guild/graph/badge.svg?token=QRDTDEUZ6X)](https://codecov.io/github/amiantos/writers-guild)

## Features

- **Interactive Story Writing** - Pick one or multiple characters, optionally assign a character as your persona, and go on an adventure with them
- **Character Card Support** - Import Tavern V2 character cards from PNG or CHUB (or create one from scratch)
- **Full Lorebook Support** - Import SillyTavern lorebooks with fully featured activation engine
- **ST Macro Support** - Supports ST macros like `{{random:a,b,c}}` and `{{pick:x,y,z}}`
- **Generation Control** - Continue the story from a specific character's perspective; open-ended generation based on story context; or request specific events to occur.

## Motivations

After years of using SillyTavern, I realized the character cards I enjoyed interacting with the most were very prose-like, and I started to suspect that the "chat" oriented nature of SillyTavern was actually preventing LLMs from fulfilling their potential as interactive story writers, and likely causing a lot of common issues (like repetitive messages, low creativity, etc).

So I decided to make Writers Guild, which uses the same character cards and lorebooks as SillyTavern, but uses them to write in a format more akin to a short story or novel. Writers Guild also attempts to enforce a consistent perspective (third) and tense (past), which is something a lot of character card authors struggle with, so it has a button to automatically rewrite the original greeting from the character into a consistent style (the most useful feature, imho).

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

## API

The server runs on port 8000 and provides:
- `/api/stories` - Story management
- `/api/characters` - Character library
- `/api/lorebooks` - Lorebook management
- `/api/settings` - User settings
- `/` - Serves the Vue client (production) or forwards to Vite (dev)
