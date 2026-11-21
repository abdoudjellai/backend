# AGENTS.md

Confirmely AI backend: Express 5 + TypeScript (ESM) API. Single business-owner account, JSON-file
storage, an in-process AI agent (AIGrid/OpenAI-compatible), and a Telegram bot.

`README.md` documents the HTTP API and data model, but it is **stale for Milestone 3**: it claims n8n
owns AI orchestration and that AI/Telegram are unimplemented. The code now contains an in-process AI
agent (`src/modules/ai/`), AI order analysis, and a Telegram webhook. Trust the code over the README.

## Commands

- `npm run dev` — tsx watch; loads `.env` unless `NODE_ENV=test`.
- `npm run typecheck` — `tsc --noEmit` over `src/`, `tests/`, and `vitest.config.ts`.
- `npm test` — full Vitest suite.
- `npx vitest run tests/unit/phone.test.ts` — one test file; add `-t "name"` to filter.
- `npm run build` — emit `src/` to `dist/` (`tsconfig.build.json`); `npm start` runs `dist/server.js`.
- `npm run seed` — demo data. **Stop the server first** (single-process storage). No-op if the
  configured owner already has a store.
- There is no lint or formatter script; typecheck + tests are the verification gate.

## Architecture boundaries

- Module layout: `src/modules/<name>/` with `*.routes.ts`, `*.controller.ts`, `*.service.ts`,
  `*.validation.ts`, `*.model.ts`. Controllers parse input with Zod; business rules live in services.
- Responses use `sendSuccess(req, res, data, status?)`; errors are thrown as `AppError` (Express 5
  forwards async rejections). Error codes: `src/shared/constants/error-codes.ts`.
- All `/stores` routes have `authenticate`; `/:storeId` adds `authorizeStore`. Handlers get the owner
  via `getAuth(req)` and the verified store via `getStore(req)` — both throw if middleware is missing.
  Never trust a `storeId` from a body; wrong-owner resources return 404, not 403.
- Persistence only through `storage.<collection>` (`src/storage/`). Never read/write `data/*.json`
  directly. `JsonCollection` writes are queued and atomic; uniqueness checks belong in the
  `create`/`update`/`delete` `guard` callbacks so they run inside the write lock. One process per
  data directory.
- AI tools (`src/modules/ai/tools/`) bypass HTTP and call services/storage directly with a trusted
  `storeId` from the agent loop. AI calls only after `isAiConfigured()`; otherwise throw
  `AppError.businessRule(...)` (409).
- Telegram webhook is public, accepts only `X-Telegram-Bot-Api-Secret-Token`, returns 200 immediately,
  and processes asynchronously (failures are logged only). `/telegram/status` and `/setup-webhook`
  require auth. If `TELEGRAM_WEBHOOK_SECRET` is unset, webhook secret validation is disabled.

## Conventions that differ from defaults

- ESM + `module: NodeNext` + `verbatimModuleSyntax`: **relative imports must end in `.js`** and
  type-only imports must use `import type`. TypeScript also enables `noUncheckedIndexedAccess`,
  `noUnusedLocals`, and `noUnusedParameters`.
- Money is integer DZD; phone numbers are normalized Algerian formats (`src/shared/utils/phone.ts`).
- Order status transitions are defined in `src/modules/orders/order-status.ts`; pricing is always
  recalculated from the catalog (`order-pricing.ts`), never from request prices.
- Dashboard AI chat (`POST /api/v1/ai/chat`) reuses the Telegram agent path with user key `dashboard`,
  so orders created there are stored with `source: "telegram"` and `platformCustomerId: "dashboard"`.
  It always uses the owner's **first** store.
- Owner AI assistant (`src/modules/owner-assistant/`, `/api/v1/owner-assistant`) is read-only and
  documented in the README. Its tool JSON schemas are generated from the Zod schemas in
  `owner-assistant.tools.ts` — change the Zod schema, never hand-write parameters. All date maths
  goes through `owner-assistant.periods.ts` (fixed UTC+1, Africa/Algiers). Its conversations are
  persisted (`ownerConversations`/`ownerMessages`); a failed AI call persists nothing.
- `agent-loop.ts` is shared by the Telegram/dashboard customer agent and the owner assistant; run
  the whole suite after changing it.
- Customer-agent conversation memory is process-local (keyed `storeId:userId`, 30-min TTL) and lost on restart;
  `startCleanup()` is currently never called, so inactive sessions are only swept lazily on access.

## Testing

- `vitest.config.ts` injects the full test env; tests **never read `.env`**. `tests/setup.ts` assigns
  each test file its own temp `DATA_DIR` before modules import.
- Integration tests call `await storage.open()` in `beforeAll`, then `createApp()`, then log in with
  `tests/helpers.ts` (`TEST_CREDENTIALS`, `api()`, `createStore/Product/Customer`).
- Test env has no AI/Telegram credentials, and `env` is parsed once at import. Do not expect
  `process.env` changes to enable AI mid-test; test unconfigured paths or mock `globalThis.fetch` /
  modules instead. No test makes real network calls.

## Repo gotchas

- `data/*.json` are **tracked in git** (despite the README saying they are ignored). Running the app or
  `npm run seed` can dirty them; do not commit runtime data changes.
- `opencode.json` contains a literal provider API key in `options.apiKey`. It is now in `.gitignore`;
  never force-add it, and treat the key as leaked if it is ever pushed.
- Tests that need the AI use `vi.mock("…/ai/ai.service.js")` (see `tests/integration/owner-assistant-chat.test.ts`)
  to make `isAiConfigured()` true and script `aiComplete`.
- Startup fails fast on invalid env or malformed storage JSON, listing variable/file names (never
  values). `ADMIN_PASSWORD`/`JWT_ACCESS_SECRET` placeholders are rejected only when
  `NODE_ENV=production`.
- On Windows/OneDrive, storage renames are retried on `EPERM`/`EBUSY`/`EACCES`; keep writes inside
  `JsonCollection` so this handling applies.
