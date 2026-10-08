# Changelog

All notable changes to Writers Guild are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## [1.5.1] - 2026-10-08

### Library

- The Characters section is now a shelf of portrait cards, showing each character's whole portrait
  with a band of details below it.
- The Lorebooks section is now a shelf of book covers.
- The Presets section is now a list grouped by provider.

## [1.5.0] - 2026-10-08

### Library

- The home page is now a bookshelf of story and chat cards, with layouts for desktop, tablet, and
  mobile, replacing the character quick picker. Recent setups lead with their names so a new story
  can start from one, and a card's cast and Persona link to their character pages.

## [1.4.0] - 2026-10-06

### Story mode

- Enhanced Story Mode, Continuity, and the Archivist are no longer experimental and are on for
  everyone. **Use Old Story Mode Experience** in Settings goes back to the editor and preview.
- New Story with This Story's Setup, beside Duplicate in the story list, starts a story with the
  same characters, Continuity, avatar frame positions, and narrative direction, but empty content
  and scenario.
- The Edit Story modal now holds all of a story's settings: characters, lorebooks, Continuity,
  preset, narrative perspective, and more. It opens on its own when a blank story is created. Chats
  are edited in the same modal.

### Library

- Character portraits beside stories are sharper, and thumbnails are in full colour. A one-time
  migration regenerates the images for existing characters, which can take a minute with a large
  library.

## [1.3.1] - 2026-10-04

### Experimental features

- **Enhanced Story Mode**: each passage's seam now shows the prompt that wrote it, collapsed by
  default.
- **Archivist**: suggests card edits again alongside Continuity updates, limited to facts about a
  character the story adds or elaborates on. A Continuity's Compact button asks the Archivist to
  condense it, and can be undone until the story is saved.

## [1.3.0] - 2026-09-28

### Story mode

- Narrative perspective: a story's edit modal now picks how it's told: third person (the default),
  third person limited, omniscient or objective, first person, or second person, in past or present
  tense. First person and third person limited take a narrator or viewpoint character from the
  story's characters or its Persona; second person addresses the Persona as "you". Rewrite to Third
  Person is now Rewrite to Story Perspective and follows the story's perspective.
- The default system prompt's perspective section is now a `{{perspective}}` template tag, which
  renders the old text for stories that haven't set a perspective. **Custom system prompts need
  `{{perspective}}` added to use the new setting**; the Edit Story modal warns when the story's
  preset doesn't have it.
- The scrolling quick access row and tables now shade their edges when there's more to scroll to.
  Thanks to Justin Self.

### Providers and presets

- New default Continue and Custom instruction templates: both ask for 3 paragraphs instead of 7, and
  Continue tells the model not to write actions or dialog for your Persona. Presets still on the
  default templates pick these up automatically; customized templates are left alone.

### Experimental features

- **Continuity**: text you write once about what's true across stories and chats. A story or chat
  picks a Continuity in its edit modal, and its text goes ahead of that story's or chat's own
  scenario in the prompt. Each change is kept as a version that can be restored.
- **Archivist**: for a story or chat in a Continuity, the Archivist now suggests an updated
  Continuity with what happened worked in, instead of card edits, and an accepted update is kept in
  the Continuity's History. Long reads keep going if the request drops or the modal is closed, can be
  stopped with a Stop button, and a failed read says which part failed and why.

### Removed

- **Bureaus** are gone, along with their tab. Existing Bureau data (`data/bureau.db`) is left on
  disk but no longer read.

## [1.2.0] - 2026-09-28

### Library

- Character generator: a Generate button in the Characters tab writes a new character card from a
  short idea, using the default preset or one you pick, with an optional lorebook as world context.
  The card can be edited before saving, and its appearance details are added to the description.
- Deleting a character now lists the stories it appears in, flagging any that include other
  characters, and one confirmation deletes the character and those stories together.

### Experimental features

- **Archivist**: adds a Review Cards button to stories and chats. The Archivist reads what happened
  and suggests small edits to the cast's descriptions and personalities for you to accept, edit, or
  reject. Accepted edits show in each card's History and can be restored.

### Fixes

- Long confirmation dialog messages now scroll instead of overflowing the screen.

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
