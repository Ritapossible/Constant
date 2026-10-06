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
| 25 | The balance covers amount + fee before a buy; the fee never counts against the weekly cap; a negative fee never buys. | Fee is revenue, not a way to overspend or block a chosen day (D-020). rules: INV-25 |

## Prepaid autopilot (D-028 to D-043) — PLAN step 2

| # | Invariant |
|---|---|
| 26 | Only a reading from a trusted source at or below the line triggers a threshold buy (SENSING table). |
| 27 | Data is bought automatically on a network reading under 24h old; on the phone's count alone only if the owner opted in, labelled estimated; otherwise the user is asked (D-045). | rules: INV-27 |
| 28 | Electricity buys on a forecast only when the owner opted in, and only on the pessimistic bound. |
| 29 | A forecast never raises an amount, a cap or a threshold. |
| 30 | At most one spare token outstanding per meter; the next is bought only after the spare is marked used or a reading shows it keyed. | rules: INV-30 (property) |
| 31 | A reading from the app is accepted only for a line that phone is registered to; a reading never changes the payee. |
| 32 | Every number shown to a customer is labelled measured or estimated. |
| 33 | A running-low probability is always in [0, 1], rises with time and falls with more remaining. | rules: INV-33 (property) |
| 34 | Running-low reminders: none while learning (<3 days), none below the threshold, at most one per line per 24h, none in quiet hours. A reminder never moves money. | rules: INV-34 |
| 35 | Wallet runway names the first upcoming charge that the money set aside cannot cover, and the exact shortfall. | rules: INV-35 |
| 36 | A user can withdraw any amount except money committed to an open order, only to a verified account in their name; payouts stop with the kill switch. | rules: INV-36 (property) |
| 37 | A pot pays only its own line. Moving money between pots needs the user's explicit permission each time. | pending |
| 38 | Cancelling a line returns its pot to the main balance in the same transaction; no payment is made for a cancelled or paused line. | pending |
| 39 | A cable renewal never pays above the user's cap; a price rise is asked about once. | pending |
| 40 | A failed, menu or SMS-deferred USSD reply is never a low balance and never triggers a buy. | rules: INV-40 (property) |
| 41 | Never guess the SIM on a dual-SIM phone; never auto-buy a data plan not known to add to the active bundle. | rules: INV-41 |
| 42 | Light forecasts show no percentage before 4 readings over 7 days, and nothing before 2 readings. | rules: INV-42 |
| 43 | Light usage is counted per hour of grid supply; units come from vend receipts, never amount ÷ tariff. | rules: INV-43 |
| 44 | A spare token is bought only when the cautious run-out is within the lead time, never while one is waiting; an old spare triggers a reminder, not a second spare. | rules: INV-44 |
| 45 | Dollar path: the on-chain charge is confirmed before the vend; a charge never exceeds the user's signed allowance; a quote above it asks the user. | pending (RAILS) |
| 46 | Dollar deposits are credited only for the listed USDC and USDT contracts on Base (and USDC on Arc via CCTP); anything else is quarantined for manual review. | pending (RAILS) |
