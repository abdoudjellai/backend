# Confirmely AI — Backend

Node.js + TypeScript backend for Confirmely AI, an AI-powered e-commerce order and logistics copilot.

**n8n is the AI brain; this backend is the secure source of truth and the owner of all business operations.**
The backend owns authentication, store-scoped data (MongoDB), validation, idempotency, business rules and
reply/action authorization. It contains no LLM prompts, model calls or agent orchestration — those live in n8n.

> **Status: Milestone 1 (backend foundation) complete.** No business endpoints exist yet.
> Messenger integration is **not** live.

## Stack

| Concern        | Choice                                             |
| -------------- | -------------------------------------------------- |
| Runtime        | Node.js ≥ 20.12 (developed on Node 26), ESM        |
| Language       | TypeScript, `strict` + extra strictness flags      |
| HTTP           | Express 5                                          |
| Database       | MongoDB via Mongoose                               |
| Validation     | Zod (environment now; requests from Milestone 2)   |
| Logging        | Pino + pino-http (JSON; pretty-printed in dev)     |
| Security       | Helmet, explicit CORS allowlist, 100 kb body limit |
| Tests          | Vitest + Supertest + mongodb-memory-server         |

## Prerequisites

- **Node.js 20.12+** and npm.
- **MongoDB** reachable at `MONGODB_URI` to run the server, for example:
  - local install: [MongoDB Community Server](https://www.mongodb.com/try/download/community)
  - Docker: `docker run -d --name confirmely-mongo -p 27017:27017 mongo:7`
  - a MongoDB Atlas cluster (use a `mongodb+srv://` URI)

  Tests do **not** need MongoDB installed: they start a throwaway in-memory instance.

## Setup

```powershell
npm install
Copy-Item .env.example .env   # then edit .env
```

Only the **Core** section of `.env.example` is read today. JWT, n8n and Meta variables are placeholders for
later milestones; Meta credentials will never be required for local development.

| Variable                              | Required | Default                 | Notes                                        |
| ------------------------------------- | -------- | ----------------------- | -------------------------------------------- |
| `NODE_ENV`                            | no       | `development`           | `development` \| `test` \| `production`      |
| `PORT`                                | no       | `4000`                  |                                              |
| `API_BASE_URL`                        | no       | `http://localhost:4000` | Used in startup log                          |
| `FRONTEND_ORIGIN`                     | **yes**  | —                       | Comma-separated CORS allowlist of origins    |
| `MONGODB_URI`                         | **yes**  | —                       | `mongodb://` or `mongodb+srv://`             |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | no       | `10000`                 | How long startup waits for MongoDB           |
| `LOG_LEVEL`                           | no       | `info`                  | `fatal` … `trace`, or `silent`               |

Invalid configuration stops the process at startup with a list of the offending variable names (values are
never printed).

## Scripts

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | Start with hot reload (`tsx watch`)                 |
| `npm run build`     | Compile `src/` to `dist/`                           |
| `npm start`         | Run the compiled build                              |
| `npm run typecheck` | Type-check `src/` and `tests/` without emitting     |
| `npm test`          | Run all unit and integration tests once             |
| `npm run test:watch`| Run tests in watch mode                             |

The first `npm test` run downloads a MongoDB binary for `mongodb-memory-server` (cached afterwards).

## Endpoints

| Method | Path      | Auth | Description                                                                 |
| ------ | --------- | ---- | --------------------------------------------------------------------------- |
| GET    | `/health` | none | `200` when the service and MongoDB are usable, `503` when MongoDB is not.  |

```powershell
Invoke-RestMethod http://localhost:4000/health
```

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "timestamp": "2026-11-20T10:00:00.000Z",
    "uptimeSeconds": 12,
    "checks": { "database": "connected" }
  },
  "requestId": "6f1c2a4e-..."
}
```

Business APIs will be mounted under `/api/v1`.

## Conventions

**Response envelopes.** Every response uses one of:

```json
{ "success": true,  "data": { }, "requestId": "..." }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "details": [] }, "requestId": "..." }
```

Error codes are listed in `src/shared/constants/error-codes.ts`. Unexpected errors always return
`500 INTERNAL_ERROR` with a generic message; stack traces and database errors are logged server-side only.

**Request IDs.** Each request gets an `X-Request-Id` response header, also included in the envelope and in every
log line. A caller (e.g. n8n) may send its own `X-Request-Id` (max 128 chars of `A-Z a-z 0-9 . _ : -`); anything
else is replaced with a fresh UUID.

**Logging.** Request logs contain method, path (no query string), status and timing — never headers, so
`Authorization`, cookies and signatures cannot leak. Known secret fields are redacted if logged explicitly.

**Errors.** Throw `AppError` (from `src/shared/errors/app-error.ts`) for expected failures; Express 5 forwards
both sync and async errors to the central handler.

**MongoDB safety.** `strictQuery` and `sanitizeFilter` are enabled globally, so `$` operators smuggled in through
request values are neutralised. Startup fails fast if MongoDB is unreachable; after a successful connection the
driver reconnects automatically while `/health` reports `503`.

## Project structure

```text
src/
├── app.ts                  # Express app factory (no I/O) — used by server and tests
├── server.ts               # Entry point: connect DB, listen, graceful shutdown
├── config/
│   ├── env.ts              # Zod-validated environment
│   ├── database.ts         # Mongoose connection + status
│   └── logger.ts           # Pino logger + redaction
├── middleware/
│   ├── request-id.ts
│   └── error-handler.ts    # 404 + centralized error envelope
├── modules/
│   └── health/             # routes → controller → service
├── routes/
│   └── index.ts            # /api/v1 router (empty until Milestone 2)
└── shared/
    ├── constants/error-codes.ts
    ├── errors/app-error.ts
    ├── types/api.ts        # envelope types, Request.requestId
    └── utils/http-response.ts
tests/
├── unit/
└── integration/
```

New features go in `src/modules/<name>/` as `*.routes.ts`, `*.controller.ts`, `*.service.ts`,
`*.validation.ts` and `*.model.ts`, keeping controllers thin and business rules in services.

## Roadmap

1. ✅ Backend foundation
2. Auth, users, stores, store membership
3. Customers, conversations, messages (idempotent ingestion)
4. Products and order drafts (trusted pricing, state transitions, audit)
5. n8n integration (service auth, internal tool endpoints, AI result callback)
6. Approvals and outbound messaging (Messenger + mock adapter)
7. Dashboard APIs, analytics, OpenAPI, seed data
