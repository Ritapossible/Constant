# Invariants

If any of these ever fails, it is a bug that costs a customer money or their light. Each one maps to a test. "Rules" tests are pure and live in `packages/rules/test`. "DB" and "Worker" tests need Postgres and arrive in PLAN steps 2–4; until then they are listed as **pending**.

| # | Invariant | Where it is enforced | Test |
|---|---|---|---|
| 1 | A scheduled buy runs only when next_run_at is due, the site is schedule mode, verified, active, funded, inside the weekly cap, outside the minimum gap, and has no open order. | `decideSchedule` | rules: `schedule.invariants` INV-1 (table + property) |
| 2 | Silence does not cancel a scheduled buy. | `decideSchedule` has no input for inbound activity | rules: INV-2/3 |
| 3 | Silence does not create an early buy. | `not_due` | rules: INV-2/3 |
| 4 | A frozen site does not buy. | `frozen` | rules: INV-4 |
| 5 | Amount above the balance or the weekly cap does not buy. | `insufficient`, `weekly_cap` | rules: INV-5 (boundary to the kobo) |
| 6 | Two runs inside the minimum gap do not buy twice; scheduler and LOW share the gap. An open order counts as a buy. | `too_soon`, `in_flight`; row lock in db | rules: INV-6 · db: **pending** (concurrent LOW + scan) |
| 7 | A duplicate webhook or retried job does not vend twice. | unique idempotency keys (`keys.ts`) | rules: INV-7 · db: **pending** |
| 8 | A partner timeout does not vend twice. No saved partnerRef: stop, freeze site, page a human. | `recoverVending`, order state machine | rules: INV-8 · worker: **pending** (both crash cases) |
| 9 | SKIP cancels only the next run. It does not freeze. | `skipped` → `advance` | rules: INV-9 |
| 10 | The site phone cannot change meter, DisCo, amount, days or owner phone. It may send LOW and SKIP only. | `routeInbound` | rules: INV-10 |
| 11 | The token is stored before SMS. SMS failure resends the stored token; it never buys again. | order state machine | rules: INV-11 · worker: **pending** |
| 12 | Ledger vs partner disagreement stops vending for everyone until a human clears it. | `reconcile`, `killed` | rules: INV-12 |
| 13 | A vend is settled only from the signed webhook or fetch(partnerRef). | order state machine | rules: INV-13 |
| 14 | The full token never appears in a URL, a log line or the public receipt. | redaction in logger, receipt view model | api: **pending** |
| 15 | Once the mandate is wired, spend succeeds before vend. Until then, nothing pretends the chain is in the path. | not scheduled (D-011) | — |
| 16 | An alert site never creates an order, writes a vend entry, or calls the partner. | `decideSchedule` → `not_schedule`; `decideAlert` has no amount | rules: INV-16 (property) · worker: **pending** |
| 17 | No unit reading, no alert. Above the threshold, no owner alert. | `decideAlert` | rules: INV-17 |
| 18 | LOW on an alert site does not buy. | `routeInbound` | rules: INV-18 |
| 19 | A scheduled buy does not wait for a unit reading. | `decideSchedule` has no reading input | rules: INV-19 |

## Added beyond the original spec

| # | Invariant | Why |
|---|---|---|
| 20 | One open order per site. | Closes the double-spend window between vend call and acceptance (D-004). |
| 21 | A missed run is never bought late on a different local day; the owner is told once. | "No catch-up" made precise (D-006). |
| 22 | After any buy, the next run is at least `min_hours` away. | A LOW on Sunday must not silently eat Monday (D-007). |
| 23 | Every owner notice is sent at most once per (site, notice, slot). | `noticeKey`; stops the "notify every minute" loop. |
| 24 | A token SMS fits in one GSM-7 segment. | Cost and delivery on basic phones (D-019). copy: **pending** |
