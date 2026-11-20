# Confirmely AI — Backend

Node.js + TypeScript backend for Confirmely AI, an AI-powered e-commerce order and logistics copilot.

**n8n is the AI brain; this backend is the secure source of truth and the owner of all business operations.**
The backend owns authentication, store-scoped business data, validation and business rules. It contains no LLM
prompts, model calls or conversation management — those live in n8n.

> **Status:** Milestone 1 (foundation) and Milestone 2 (business data & management) complete.
> n8n, Messenger and courier integrations are **not** implemented yet.

## Quick start

```powershell
npm install
Copy-Item .env.example .env     # then set ADMIN_PASSWORD and JWT_ACCESS_SECRET
npm run seed                    # optional: demo store, products, customers, orders, AI analyses
npm run dev                     # http://localhost:4000
```

Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`:

```powershell
$login = Invoke-RestMethod -Method Post http://localhost:4000/api/v1/auth/login `
  -ContentType "application/json" -Body '{"email":"owner@confirmely.ai","password":"change-me"}'
$h = @{ Authorization = "Bearer $($login.data.accessToken)" }
Invoke-RestMethod http://localhost:4000/api/v1/stores -Headers $h
```

## Stack

| Concern    | Choice                                                             |
| ---------- | ------------------------------------------------------------------ |
| Runtime    | Node.js ≥ 20.12 (developed on Node 26), ESM                        |
| Language   | TypeScript, `strict` + extra strictness flags                      |
| HTTP       | Express 5                                                          |
| Storage    | JSON files in `data/` (MongoDB intentionally postponed)            |
| Validation | Zod for env, bodies, params and query strings                      |
| Auth       | JWT (HS256, `jose`), login rate limit (`express-rate-limit`)       |
| Logging    | Pino + pino-http (JSON; pretty-printed in dev)                     |
| Security   | Helmet, explicit CORS allowlist, 100 kb body limit                 |
| Tests      | Vitest + Supertest                                                 |

## Configuration

| Variable                | Required | Default                 | Notes                                                    |
| ----------------------- | -------- | ----------------------- | -------------------------------------------------------- |
| `NODE_ENV`              | no       | `development`           | `development` \| `test` \| `production`                  |
| `PORT`                  | no       | `4000`                  |                                                          |
| `API_BASE_URL`          | no       | `http://localhost:4000` | Used in startup log                                      |
| `FRONTEND_ORIGIN`       | **yes**  | —                       | Comma-separated CORS allowlist                           |
| `DATA_DIR`              | no       | `./data`                | Folder with the JSON storage files                       |
| `ADMIN_EMAIL`           | **yes**  | —                       | The owner's login email                                  |
| `ADMIN_PASSWORD`        | **yes**  | —                       | ≥ 8 chars; placeholder rejected in production            |
| `ADMIN_ID`              | no       | `owner_001`             | Stable owner ID stored on every store                    |
| `ADMIN_NAME`            | no       | `Store Owner`           | Shown by `/auth/me`                                      |
| `JWT_ACCESS_SECRET`     | **yes**  | —                       | ≥ 32 random chars; placeholder rejected in production    |
| `JWT_ACCESS_EXPIRES_IN` | no       | `8h`                    | e.g. `15m`, `8h`, `7d`                                   |
| `LOG_LEVEL`             | no       | `info`                  | `fatal` … `trace`, or `silent`                           |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
Invalid configuration stops startup and lists the offending variable names (values are never printed).

## Scripts

| Command              | What it does                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| `npm run dev`        | Start with hot reload                                                   |
| `npm run seed`       | Add demo data for the configured owner (**stop the server first**)      |
| `npm run build`      | Compile `src/` to `dist/`                                               |
| `npm start`          | Run the compiled build                                                  |
| `npm run typecheck`  | Type-check `src/` and `tests/`                                          |
| `npm test`           | Run all tests (each test file uses its own temporary data folder)       |

## Authentication

One predefined business-owner account, configured in `.env`. There is **no registration**, no users file and no
password reset.

- `POST /api/v1/auth/login` compares email (case-insensitive) and password in constant time and returns a JWT.
  Wrong email and wrong password give the same `401 INVALID_CREDENTIALS`. Limited to 10 attempts / 15 min per IP.
- Send the token as `Authorization: Bearer <token>` on every other endpoint. Missing, malformed, expired or
  foreign tokens get `401`.
- Tokens contain the owner ID (`sub`) and email only. Changing `ADMIN_ID` or `JWT_ACCESS_SECRET` invalidates all
  existing tokens.

## Store ownership

Every store has an `ownerId` set by the backend from the token — never from request input. Every route under
`/stores/:storeId` first loads the store and checks it belongs to the authenticated owner; otherwise it returns
`404 Store not found` (never 403, so store IDs are not revealed). Customers, products, orders and analyses are
always read and written inside that verified store; a `storeId` in a request body is ignored, and references to
records of another store are rejected.

## Storage

```text
data/
├── stores.json
├── customers.json
├── products.json
├── orders.json
└── ai-analytics.json
```

- Missing files are created as `[]` at startup. A file with malformed JSON stops startup with a message naming the
  file; the file is not modified.
- `src/storage/json-collection.ts` is the only code that touches the files. Business modules call
  `findAll / findOne / findById / count / create / update / delete` on `storage.<collection>`.
- Every write goes through a per-file queue and is saved atomically (temp file + rename), so concurrent requests
  never overwrite each other. Uniqueness checks (e.g. duplicate customer phone) run inside that queue.
- File names are fixed in `src/storage/storage.ts`; user input never becomes a file path.
- `data/*.json` is git-ignored. **Reset:** stop the server, delete `data/*.json`, optionally `npm run seed`.

Limitations: one server process per data folder; all data held in memory; writes spanning several files are not
transactional. Swapping to MongoDB means reimplementing `JsonCollection` / `Storage`, not the services.

## Data model

All IDs are generated (`store_…`, `customer_…`, `product_…`, `order_…`, `analysis_…`); all records have
`createdAt` / `updatedAt` (ISO-8601). Money is whole **DZD**.

```text
Store (ownerId = ADMIN_ID)
 ├── Customer  (storeId)            unique per store: phone; source + platformCustomerId
 ├── Product   (storeId)            price, stock, sizes, colors
 ├── Order     (storeId, customerId, items[].productId)
 │     └── AiAnalysis (storeId, orderId)   history kept, never overwritten
```

**Customer** — `name`, `phone` (normalized Algerian format, e.g. `+213 550 12 34 56` → `0550123456`), `wilaya`,
`address`, `source` (`manual|messenger|whatsapp|instagram|website|phone`), `platformCustomerId` (e.g. Messenger
PSID). Creating a customer whose phone, or platform ID for the same source, already exists in the store returns
`409 CONFLICT` with `existingCustomerId`, so n8n can reuse the customer. Names are never used for matching.
`GET …/customers?phone=…` / `?source=messenger&platformCustomerId=…` look up returning customers. Customers with
orders cannot be deleted.

**Product** — `name`, `description`, `price` (integer DZD), `stock` (integer), `sizes` (numbers or labels),
`colors`. Deleting a product does not affect existing orders (they hold snapshots).

**Order** — `items[]` (`productId`, `productName`, `size`, `color`, `quantity`, `unitPrice`, `lineTotal`),
`totalAmount`, `currency`, `delivery` (`wilaya`, `address`, `phone`, `company`, `trackingNumber`), `status`,
`source`, `notes`, `statusHistory[]`. Rules:

1. The customer and every product must belong to the store (`422 INVALID_REFERENCE`).
2. Names and prices are copied from the catalog; any price/total in the request is ignored.
3. Size/color must be offered by the product; quantities 1–100; total quantity per product ≤ stock
   (`409 INSUFFICIENT_STOCK`). Stock is **not** deducted.
4. New orders start as `pending_confirmation` (default) or `draft` — never confirmed. Courier/tracking cannot be set
   at creation. Delivery fields not sent are copied from the customer.
5. Status changes only via `PATCH …/status`, following this table:

| From                   | Allowed to                                  |
| ---------------------- | ------------------------------------------- |
| `draft`                | `pending_confirmation`, `cancelled`         |
| `pending_confirmation` | `draft`, `confirmed`, `cancelled`           |
| `confirmed`            | `pending_dispatch`, `cancelled`             |
| `pending_dispatch`     | `confirmed`, `shipped`, `cancelled`         |
| `shipped`              | `delivered`, `refused`, `returned`          |
| `delivered`            | `returned`                                  |
| `refused`              | `returned`                                  |
| `returned`, `cancelled`| — (final)                                   |

   Entering `confirmed`/`pending_dispatch`/`shipped` requires delivery wilaya, address and phone, plus a size/color
   on items whose product has those options. Confirming re-checks that products still exist and stock suffices.
   Shipping requires `delivery.company`. Missing fields are listed in `error.details.missingFields`.
6. Items and customer are editable only in `draft`/`pending_confirmation` (re-priced from the catalog); the address
   until shipped; courier/tracking until an outcome. Orders cannot be deleted — cancel them.

**AiAnalysis** — `orderId`, `returnRisk` (0–1), `riskLevel` (`low|medium|high`), `recommendedCourier`,
`recommendations[]`. Produced by n8n (later milestone); the backend only validates and stores it. The order must
belong to the store.

## API

All endpoints except `/health` and `/auth/login` require a Bearer token. Lists accept `page` (default 1) and
`limit` (default 20, max 100) and return `{ items, pagination: { page, limit, total, totalPages } }`, newest first.

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/health` | `200` when storage is usable, else `503` |
| POST | `/api/v1/auth/login` | `{ email, password }` → `{ accessToken, tokenType, expiresAt, user }` |
| GET | `/api/v1/auth/me` | Owner profile |
| POST | `/api/v1/stores` | `{ name, description? }` |
| GET | `/api/v1/stores` | The owner's stores |
| GET / PATCH / DELETE | `/api/v1/stores/:storeId` | DELETE only when the store is empty |
| POST / GET | `/api/v1/stores/:storeId/customers` | Filters: `q`, `phone`, `source`, `platformCustomerId` |
| GET / PATCH / DELETE | `/api/v1/stores/:storeId/customers/:customerId` | |
| POST / GET | `/api/v1/stores/:storeId/products` | Filters: `q`, `inStock=true\|false` |
| GET / PATCH / DELETE | `/api/v1/stores/:storeId/products/:productId` | |
| POST / GET | `/api/v1/stores/:storeId/orders` | Filters: `status`, `customerId`, `from`, `to` |
| GET / PATCH | `/api/v1/stores/:storeId/orders/:orderId` | PATCH: `customerId`, `items`, `delivery`, `notes` |
| PATCH | `/api/v1/stores/:storeId/orders/:orderId/status` | `{ status, note? }` |
| POST / GET | `/api/v1/stores/:storeId/ai-analytics` | Filters: `orderId`, `riskLevel` |
| GET | `/api/v1/stores/:storeId/orders/:orderId/ai-analytics` | `{ orderId, latest, history }` |
| GET | `/api/v1/stores/:storeId/analytics/overview` | `{ business, ai }` |
| GET | `/api/v1/stores/:storeId/analytics/orders` | Optional `from`, `to` |
| GET | `/api/v1/stores/:storeId/analytics/ai` | |

Date filters accept `2026-11-20` (whole day, UTC) or a full ISO-8601 datetime.

### Analytics

- **Business:** total orders, customers, products; orders by status (every status, zeros included); revenue =
  sum of `totalAmount` of orders currently `delivered`.
- **Orders:** the above plus orders per UTC day, average delivered order value, and **actual** delivery outcomes:
  `actualReturnRate = (refused + returned) / (delivered + refused + returned)`.
- **AI:** total analyses, analyzed orders, average **predicted** return risk, high-risk orders, risk distribution and
  courier recommendations — each order counted once, by its latest analysis.

Predicted risk and actual return rate are separate metrics. When there is no data, counts are `0` and averages/rates
are `null` — nothing is estimated.

### Example: create an order

```http
POST /api/v1/stores/store_…/orders
Authorization: Bearer …

{ "customerId": "customer_…", "items": [{ "productId": "product_…", "size": 42, "color": "black", "quantity": 2 }], "source": "messenger" }
```

```json
{
  "success": true,
  "data": {
    "id": "order_…", "storeId": "store_…", "customerId": "customer_…",
    "items": [{ "productId": "product_…", "productName": "Black Shoes", "size": 42, "color": "Black",
                "quantity": 2, "unitPrice": 4500, "lineTotal": 9000 }],
    "totalAmount": 9000, "currency": "DZD",
    "delivery": { "wilaya": "Blida", "address": "Blida Centre", "phone": "0550123456", "company": null, "trackingNumber": null },
    "status": "pending_confirmation", "source": "messenger", "notes": null,
    "statusHistory": [{ "status": "pending_confirmation", "at": "2026-11-20T10:00:00.000Z", "note": null }],
    "createdAt": "2026-11-20T10:00:00.000Z", "updatedAt": "2026-11-20T10:00:00.000Z"
  },
  "requestId": "…"
}
```

## Conventions

- **Envelopes:** `{ success: true, data, requestId }` / `{ success: false, error: { code, message, details? }, requestId }`.
  Codes: `src/shared/constants/error-codes.ts`. Unexpected errors return a generic `500 INTERNAL_ERROR`.
- **Status codes:** 400 validation, 401 auth, 404 not found / not owned, 409 conflict / business rule / stock /
  transition, 422 invalid reference, 429 rate limited, 503 storage unavailable.
- **Request IDs:** `X-Request-Id` on every response and log line; a safe caller-supplied ID is reused.
- **Logging:** method, path (no query string), status and timing only — never headers or bodies, so tokens,
  passwords and customer details are not logged.
- **Modules:** `src/modules/<name>/` with `*.model.ts`, `*.validation.ts`, `*.service.ts`, `*.controller.ts`,
  `*.routes.ts`. Controllers parse input with Zod and call services; business rules live in services.

## Project structure

```text
src/
├── app.ts, server.ts
├── config/            env.ts, logger.ts
├── storage/           json-collection.ts (file engine), storage.ts (collections), index.ts
├── middleware/        request-id, authenticate, authorize-store, error-handler
├── modules/
│   ├── auth/          login, /me, JWT
│   ├── stores/        + stores.routes.ts mounts every store-scoped router
│   ├── customers/
│   ├── products/
│   ├── orders/        order-pricing.ts, order-status.ts (pure rules), service, …
│   ├── ai-analytics/
│   ├── analytics/     analytics.calculations.ts (pure), service, …
│   └── health/
├── routes/index.ts    /api/v1 router
├── scripts/seed.ts
└── shared/            constants, errors, types, utils (phone, pagination), validation
tests/
├── setup.ts, helpers.ts
├── unit/              env, phone, storage, pricing, status, analytics, error handler
└── integration/       health, auth, stores, customers, products, orders, ai-analytics, app
```

## Roadmap

1. ✅ Backend foundation
2. ✅ Business data & management (auth, stores, customers, products, orders, AI analytics, dashboard analytics)
3. n8n integration (service authentication, internal tool endpoints, AI result callback)
4. Messaging channels (Messenger webhook, conversations)
5. Courier integrations and dispatch
