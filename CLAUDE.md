# CLAUDE.md

Guidance for AI coding agents working on Writers Guild. Everything in "The CI
gate" below is enforced by GitHub Actions on every PR to `main`.

Writers Guild is a self-hosted, AI-powered short story writing app: an Express
server (plain JavaScript, ESM) with SQLite storage, plus a Vue 3 + Vite client.

## Layout

- `server/` — Express routes (`src/routes/`), services (`src/services/`,
  including the LLM provider adapters in `services/providers/`), SQLite storage
- `vue_client/` — Vue 3 SPA (components, views, composables)
- `shared/` — code imported by both server and client
- `data/` — runtime user data; never read or write it from tests or tooling
- Tests are Vitest, colocated in `__tests__/` directories next to the code

## The CI gate — run before every PR

| Command                | What it is                                  |
| ---------------------- | ------------------------------------------- |
| `npm run lint`         | **oxlint** — errors fail CI, warnings don't |
| `npm run format:check` | **oxfmt**                                   |
| `npm test`             | **Vitest**, server + client suites          |

All three must pass before opening a PR. `npm run format` writes formatting
fixes; `npm run lint:fix` applies safe lint fixes.

## Code style

- **Formatter is `oxfmt`, NOT Prettier; linter is `oxlint`, NOT ESLint.** Do
  not run or configure Prettier/ESLint — they fight the house style (single
  quotes, 100-col width, trailing commas).
- Tooling conventions mirror
  [amiantos/lurker](https://github.com/amiantos/lurker): keep `.oxfmtrc.json`
  and `.oxlintrc.json` minimal, stating only non-default choices.
- **Unused vars/params:** prefix with `_` to satisfy the lint rule. For Express
  error middleware that means `(err, req, res, _next)` — keep the 4-arg arity,
  Express uses it to detect error handlers.
- Match the surrounding code's naming, comment density, and idiom.

## Users

- Each row of `OWNED_TABLES` (`server/src/services/database.js`) belongs to a user. **Every query
  on one must keep to the current user**: `AND ${MINE}` (`user_id = current_user_id()`), or
  `mineThrough()` for a table that hangs off one, and inserts set `user_id` to
  `current_user_id()`. See `server/src/services/user-context.js`.
- `current_user_id()` reads the user from AsyncLocalStorage, set per request by
  `middleware/authenticate.js`, and throws outside one. Work outside a request runs inside
  `runAsUser()`. Tests fall back to the admin (`src/__tests__/setup.js`); isolation tests turn
  that off with `setFallbackUserId(null)`.

## Testing

- `npm run test:server` / `npm run test:client` run one side on its own.
- Tests create their own temporary directories; never point them at `data/`.
