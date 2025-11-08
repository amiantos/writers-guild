# Úrscéal v2.0

A client-server novel writing application powered by DeepSeek's reasoning model and Tavern character cards.

## 🚀 What's New in v2.0

**Complete Architecture Overhaul:**
- ✅ **Multi-story support** - Create and manage multiple stories
- ✅ **Client-server architecture** - Node.js/Express backend with API
- ✅ **Multi-character stories** - Add multiple character cards to a single story
- ✅ **Server-side API proxy** - Secure API key handling
- ✅ **Filesystem storage** - JSON file-based storage (no database needed)
- ✅ **Docker support** - Easy deployment with Docker Compose
- ✅ **RESTful API** - Full API for stories, characters, personas, and settings

## Features

- **Multi-Story Management**: Create, switch between, and manage multiple stories
- **Character Card Support**: Import Tavern-compatible PNG character cards (V2/V3 format)
- **Multi-Character Stories**: Add multiple characters to any story
- **Template Placeholders**: Automatic replacement of `{{user}}`, `{{char}}`, and `{{character}}`
- **Persona System**: Define your narrator/character perspective
- **AI Generation**: Multiple modes (continue story, character response, custom prompt)
- **Reasoning Display**: See the model's thinking process
- **Server-side Generation**: API keys secured on server, streaming via SSE
- **Auto-save**: Automatic document saving every 30 seconds
- **Third-Person Past Tense**: Optional enforcement of narrative perspective
- **Asterisk Filtering**: Remove RP-style *action* marks for novel-style prose

## 📁 Project Structure

```
/server/                    # Node.js/Express backend
  server.js                 # Main server entry point
  config.yaml               # Server configuration
  /src/
    /routes/                # API endpoint handlers
    /services/              # Business logic (storage, AI, parsing)
    /middleware/            # Express middleware

/client/                    # Frontend application
  index.html
  /js/
    app.js                  # Main client application
    api-client.js           # API wrapper
  /css/
    styles.css

/shared/                    # Code shared by client & server
  tavern-parser.js          # Character card PNG parser

/data/                      # Data storage (persisted)
  /stories/
    /<story-uuid>/
      metadata.json         # Story metadata
      content.txt           # Story content
      /characters/          # Character PNGs for this story
  /personas/
    default.json            # User persona
  settings.json             # Global settings

Dockerfile                  # Docker image definition
docker-compose.yml          # Docker Compose configuration
```

## 🚀 Quick Start

### Option 1: Run Directly with Node.js

```bash
# Install dependencies
cd server
npm install

# Start the server
npm start

# Open browser to http://localhost:8000
```

### Option 2: Run with Docker

```bash
# Build and start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## ⚙️ Configuration

Edit `server/config.yaml`:

```yaml
server:
  port: 8000
  host: '0.0.0.0'

data:
  root: '../data'  # Data directory path

security:
  cors:
    origins:
      - 'http://localhost:8000'
```

## 🔧 API Endpoints

### Stories
- `GET /api/stories` - List all stories
- `POST /api/stories` - Create new story
- `GET /api/stories/:id` - Get story with content
- `PUT /api/stories/:id` - Update story metadata
- `PUT /api/stories/:id/content` - Update story content
- `DELETE /api/stories/:id` - Delete story

### Characters
- `GET /api/characters/story/:storyId` - List characters for a story
- `POST /api/characters/story/:storyId` - Upload character PNG
- `GET /api/characters/:storyId/:characterId/data` - Get character data
- `DELETE /api/characters/:storyId/:characterId` - Delete character

### Personas
- `GET /api/persona` - Get current persona
- `PUT /api/persona` - Update persona

### Settings
- `GET /api/settings` - Get all settings
- `PUT /api/settings` - Update settings

### Generation
- `POST /api/generate` - Generate content (SSE streaming)
  - Body: `{ storyId, type: 'continue'|'character'|'custom', customPrompt? }`

## 🎨 Usage

1. **First Time Setup:**
   - Server creates a default story automatically
   - Click settings (⋮) and enter your DeepSeek API key
   - (Optional) Set up your persona under "Persona"

2. **Create Stories:**
   - Click the "+" button next to the story dropdown
   - Enter a title for your new story
   - Switch between stories using the dropdown

3. **Add Characters:**
   - Click "Import Character Card" in the sidebar
   - Select a Tavern-compatible PNG file
   - Multiple characters can be added to any story

4. **Generate Content:**
   - **Continue Story**: AI continues from cursor position
   - **Character Response**: Generate from character's perspective
   - **Custom Prompt**: Provide your own generation instructions
   - **Rewrite to Third Person**: Convert existing text to third-person past tense

5. **Export:**
   - Click "Export TXT" to download your story as plain text

## 🔐 Security Notes

- API keys are stored server-side (in `data/settings.json`)
- Client never directly accesses DeepSeek API
- All data stored in plain text on filesystem
- **Not recommended for public deployment with untrusted users**
- Best for personal use or trusted local networks

## 🐳 Docker Deployment

The Docker setup uses Alpine Linux for minimal image size and includes:
- Node.js LTS
- Tini for proper signal handling
- Volume mounts for data persistence
- Configurable port mapping

```bash
# Build
docker-compose build

# Run
docker-compose up -d

# Restart
docker-compose restart

# Stop
docker-compose down
```

## 📝 Data Storage

All data is stored as JSON/text files:
- **Stories**: One directory per story with metadata.json and content.txt
- **Characters**: PNG files in story's characters/ subdirectory
- **Personas**: Single JSON file (default.json)
- **Settings**: Single JSON file (settings.json)

**Backup**: Simply copy the entire `/data` directory.

## 🛠️ Development

```bash
# Server with hot reload
cd server
npm run dev

# Or manually
node --watch server.js
```

## Template Placeholders

The following placeholders are automatically replaced in character cards:
- `{{user}}` → Your persona name (or "User")
- `{{char}}` → Character name
- `{{character}}` → Character name

These work in:
- Character descriptions
- Personality traits
- Scenarios
- System prompts
- Dialogue examples
- Post-history instructions (ignored by default)

## 📜 License

MIT

## 🙏 Acknowledgments

- [DeepSeek](https://www.deepseek.com/) for the reasoning model
- [SillyTavern](https://github.com/SillyTavern/SillyTavern) for architecture inspiration and Tavern character card format
