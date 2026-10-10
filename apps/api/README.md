# api

Fastify. The app's API under `/v1` (Privy bearer token) and partner webhooks under `/webhooks`. It never spends money; the worker does.

| Route | What it does |
|---|---|
| `GET /health` | Liveness. |
| `GET /v1/me` | Profile, naira balance (ledger and available), bank account, bills, recent renewals, whether payments are on. |
| `PATCH /v1/me` | Display name. |
| `POST /v1/funding-account` | The user's own account number (Paystack dedicated account), created once. |
| `POST /v1/cable/lookup` | Decoder lookup: name, plan, renewal price, end date. Rate-limited. |
| `POST /v1/lines` | Add a cable bill. The decoder is looked up again here and fixed; nothing about the payee is taken from the client. |
| `PATCH /v1/lines/:id` | Nickname, limit, pause/resume. Never the payee. |
| `DELETE /v1/lines/:id` | Cancel (refused while a renewal is in flight). |
| `GET /v1/orders` | Renewals. |
| `POST /webhooks/paystack` | Signed (HMAC-SHA512). Stored raw, then credits once per event. |
| `POST /webhooks/vtpass/:token` | Unsigned, so it only asks the worker to requery now. Never settles. |

Run locally with fake partners: `PARTNERS=fake DATABASE_URL=… REF_ENCRYPTION_KEY=… REF_HMAC_KEY=… WEB_ORIGINS=http://localhost:3000 VTPASS_WEBHOOK_TOKEN=… pnpm --filter @constant/api build && node apps/api/dist/main.js`. With fake sign-in, the bearer token is `fake:did:privy:<anything>`.

Tests: `TEST_DATABASE_URL=postgres://… pnpm --filter @constant/api test`.
