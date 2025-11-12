# Úrscéal

AI-powered short story writing application that supports Tavern character cards and SillyTavern lorebooks.

## Features

- **Interactive Story Writing** - Pick one or multiple characters, optionally assign a character as your persona, and go on an adventure with them
- **Character Card Support** - Import Tavern V2 character cards from PNG or CHUB (or create one from scratch)
- **Full Lorebook Support** - Import SillyTavern lorebooks with fullly featured activation engine
- **ST Macro Support** - Supports ST macros like `{{random:a,b,c}}` and `{{pick:x,y,z}}`
- **Generation Control** - Continue the story from a specific character's perspective; open-ended generation based on story context; or request specific events to occur.

## Motivations

After years of using SillyTavern, I realized the character cards I enjoyed interacting with the most were very prose-like, and I started to suspect that the "chat" oriented nature of SillyTavern was actually preventing LLMs from fulfilling their potential as interactive story writers, and likely causing a lot of common issues (like repetitive messages, low creativity, etc).

So I decided to make Ursceal, which uses the same character cards and lorebooks as SillyTavern, but uses them to write in a format more akin to a story story or novel. Ursceal also attempts to enforce a consistent perspective (third) and tense (past), which is something a lot of character card authors struggle with, so it has a button to automatically rewrite the original greeting from the character into a consistent style (the most useful feature, imho).

## Quick Start

**Local Development:**
```bash
cd server
npm install
npm start
# Open http://localhost:8000
```

**Docker:**
```bash
docker-compose up -d
```

## Setup

1. Open http://localhost:8000
2. Click Settings (⚙️) and add your DeepSeek API key
3. Import character cards and lorebooks
4. Start writing!
