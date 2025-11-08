# Úrscéal

AI-powered novel writing application with SillyTavern character cards and lorebooks.

## Features

- **Multiple Stories** - Create and manage unlimited stories
- **Character Library** - Import SillyTavern V2 character cards (PNG or create from scratch)
- **Lorebook Support** - Import SillyTavern lorebooks with full activation engine
- **Macro System** - `{{random}}`, `{{pick}}`, `{{roll}}`, `{{user}}`, `{{char}}`
- **AI Generation** - Continue story, character response, custom prompts (powered by DeepSeek)
- **Reasoning Display** - See the model's thinking process
- **Dark Mode** - Automatic based on system preference
- **Docker Support** - Easy deployment

## Project Structure

```
server/                     # Node.js/Express backend
client/                     # Frontend (HTML/CSS/JS)
shared/                     # Shared utilities
data/                       # Your data (not in repo)
  stories/                  # Story files
  characters/               # Character library (JSON + images)
  lorebooks/                # Lorebook library
  settings.json             # App settings
```

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

## How It Works

**Characters:**
- Import SillyTavern V2 character cards (PNG with embedded JSON)
- Create characters from scratch
- Characters stored in global library, reusable across stories
- Use characters as personas (narrator perspective)

**Lorebooks:**
- Import SillyTavern lorebook JSON files
- Entries auto-activate based on keywords in story content
- Advanced features: recursion, probability, inclusion groups, regex
- Full entry editor with all SillyTavern options

**Macros:**
- `{{random:a,b,c}}` - Random selection
- `{{pick:x,y,z}}` - Stable selection
- `{{roll:d6}}` or `{{roll:2d20+5}}` - Dice notation
- `{{user}}`, `{{char}}` - Context placeholders

**Generation:**
- Continue story from cursor position
- Character-specific responses (choose which character)
- Custom prompts with full context
- Real-time streaming with reasoning display

## Data Storage

All data stored as plain JSON/text files in `/data`:
- **Stories**: `stories/<id>/metadata.json` + `content.txt`
- **Characters**: `characters/<id>.json` + optional `<id>-image.png`
- **Lorebooks**: `lorebooks/<id>.json`
- **Settings**: `settings.json`

Backup = copy the `/data` folder.

## License

MIT
