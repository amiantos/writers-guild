# Changelog

All notable changes to Writers Guild are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-09-26

### Library

- Character card history: every change to a library character's card is kept as a version, listed
  in a History section on the character's page with what changed. Any version can be restored, and
  an imported card keeps an "As imported" entry once it's first edited.

### Experimental features

- **Enhanced Story Mode**: story mode as passages, in Bureau's chapter-writer layout. Each passage
  has a seam above it showing how it was written, its instruction, and the model's reasoning
  (streamed live), with hover edit, delete, and write another version, and a composer at the bottom.
  When on, it replaces the editor and preview outright.

### Fixes

- Rewrite to Third Person no longer skips its confirmation when picked from the overflow menu.

## [1.0.0] - 2026-09-25

The first versioned release of Writers Guild.

### Story mode

- Write stories with one or more characters, optionally playing one of them as your persona.
- Continue, Continue for Character, and Continue with Instruction, plus a story starter, greetings
  from character cards (rewritten in third person), Ideate, and undo/redo.
- A story scenario that replaces the characters' own scenarios in the prompt.
- Floating character avatars, image support in cards, lorebooks, and stories, and TXT export.

### Library

- Import Tavern V2 character cards from PNG, JSON, or CHUB, or create characters from scratch.
- SillyTavern lorebooks with a full activation engine: keywords, secondary keys, recursion,
  probability, and token budgets.
- SillyTavern macros such as `{{random:a,b,c}}` and `{{pick:x,y,z}}`.

### Providers and presets

- DeepSeek, OpenAI, Anthropic, OpenRouter, AI Horde, KoboldCpp, Ollama, and any OpenAI-compatible
  server, with streaming and reasoning where the provider offers them.
- Configuration presets with customizable prompt templates.

### Experimental features

Turned on under Experimental Features in Settings, and off by default.

- **Chats**: text message conversations with one or more characters, set up by a scenario you
  describe. Works with every provider, with regenerated versions of the last reply, the model's
  reasoning in a seam above each reply, and Chat Templates in each preset.
- **Bureaus**: ongoing stories written in chapters, with characters who remember, change over time,
  and can be messaged between chapters. Turned on automatically for anyone who already has a
  Bureau.
