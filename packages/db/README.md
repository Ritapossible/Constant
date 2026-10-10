# db

Postgres 16. Migrations in `migrations/` (applied in order by `migrate()`, which the api and worker run at start). Plain SQL repositories in `src/repo.ts`.

- `ledger_entries` is append-only (a trigger refuses UPDATE and DELETE). Balance is the sum.
- One open order per line: a partial unique index.
- Every webhook is stored raw in `inbound_webhooks` before it is acted on.
- Smartcards are AES-256-GCM encrypted with a key id; lookups use an HMAC (`src/crypto.ts`).
- Money columns are `bigint` and come back as JS `bigint`.

Tests need `TEST_DATABASE_URL` (a server where the user may create databases); each test file gets a fresh database.
