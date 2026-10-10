# Invariants

If any of these ever fails, it is a bug that costs a customer money or their light. Each one maps to a test. "Rules" tests are pure and live in `packages/rules/test`. "DB" and "Worker" tests need Postgres and arrive in PLAN steps 2–4; until then they are listed as **pending**.

| # | Invariant | Where it is enforced | Test |
|---|---|---|---|
| 1 | A scheduled buy runs only when next_run_at is due, the site is schedule mode, verified, active, funded, inside the weekly cap, outside the minimum gap, and has no open order. | `decideSchedule` | rules: `schedule.invariants` INV-1 (table + property) |
| 2 | Silence does not cancel a scheduled buy. | `decideSchedule` has no input for inbound activity | rules: INV-2/3 |
| 3 | Silence does not create an early buy. | `not_due` | rules: INV-2/3 |
| 4 | A frozen site does not buy. | `frozen` | rules: INV-4 |
| 5 | Amount above the balance or the weekly cap does not buy. | `insufficient`, `weekly_cap` | rules: INV-5 (boundary to the kobo) |
| 6 | Two runs inside the minimum gap do not buy twice; scheduler and LOW share the gap. An open order counts as a buy. | `too_soon`, `in_flight`; row lock in db | rules: INV-6 · db: 50 concurrent inserts → 1 order · worker: 5 concurrent scans → 1 partner call |
| 7 | A duplicate webhook or retried job does not vend twice. | unique idempotency keys (`keys.ts`) | rules: INV-7 · db: funding replay credits once · api: 5 concurrent replays → 1 credit |
| 8 | A partner timeout does not vend twice. No saved partnerRef: stop, freeze site, page a human. | `recoverVending`, order state machine, request id saved before the call | rules: INV-8 · worker: crash after send, pending → delivered, unclear → needs_human |
| 9 | SKIP cancels only the next run. It does not freeze. | `skipped` → `advance` | rules: INV-9 |
| 10 | The site phone cannot change meter, DisCo, amount, days or owner phone. It may send LOW and SKIP only. | `routeInbound` | rules: INV-10 |
| 11 | The token is stored before SMS. SMS failure resends the stored token; it never buys again. | order state machine | rules: INV-11 · worker: **pending** |
| 12 | Ledger vs partner disagreement stops vending for everyone until a human clears it. | `reconcile`, `killed` | rules: INV-12 |
| 13 | A vend is settled only from the signed webhook or fetch(partnerRef). | order state machine | rules: INV-13 |
| 14 | The full token never appears in a URL, a log line or the public receipt. | redaction in logger, receipt view model | api: smartcard never in a response or stored in clear · worker log redacts 10+ digits |
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
| 38 | Cancelling a line returns its pot to the main balance in the same transaction; no payment is made for a cancelled or paused line. | rules: INV-38 (property) · worker: paused before and after order creation (pots pending) |
| 39 | A cable renewal never pays above the user's cap; a price rise is asked about once. | rules: INV-39 (property) · worker: above_cap notice once |
| 40 | A failed, menu or SMS-deferred USSD reply is never a low balance and never triggers a buy. | rules: INV-40 (property) |
| 41 | Never guess the SIM on a dual-SIM phone; never auto-buy a data plan not known to add to the active bundle. | rules: INV-41 |
| 42 | Light forecasts show no percentage before 4 readings over 7 days, and nothing before 2 readings. | rules: INV-42 |
| 43 | Light usage is counted per hour of grid supply; units come from vend receipts, never amount ÷ tariff. | rules: INV-43 |
| 44 | A spare token is bought only when the cautious run-out is within the lead time, never while one is waiting; an old spare triggers a reminder, not a second spare. | rules: INV-44 |
| 45 | Dollar path: the on-chain charge is confirmed before the vend; a charge never exceeds the user's signed allowance; a quote above it asks the user. | rules: INV-45 (property) · worker: no vend before confirmation, re-checked on chain before charging, missing module never vends |
| 46 | Dollar deposits are credited only for the listed USDC and USDT contracts on Base (and USDC on Arc via CCTP); anything else is quarantined for manual review. | chains: token list · worker: unknown tokens quarantined, USDT's Base address on Arc rejected |
| 47 | A token goes first to the user's chosen, linked channel. | rules: INV-47 |
| 48 | If it fails or isn't confirmed in time, the next channel is tried, ending in SMS; every attempt resends the same stored token, and delivery never buys again. | rules: INV-48 |
| 49 | Delivery never retries the same channel in a loop; when all channels fail, the owner and support are told. | rules: INV-49 (property) |

## Cable renewals on the server (D-057, D-058)

| # | Invariant | Test |
|---|---|---|
| 50 | A renewal needs available money for amount + fee, to the kobo. | rules: INV-50 |
| 51 | A decoder renewed elsewhere (plan runs > 3 more days) is not paid; the run moves to the day before its new end. | rules: INV-51 · worker |
| 52 | Money held by an open order can't be spent by another order. | rules: INV-52 · db · worker (two bills, money for one) |
| 53 | The ledger is append-only: UPDATE, DELETE and TRUNCATE are refused by the database. | db |
| 54 | The payee is looked up and fixed by the server when the bill is added; no request can change it. | api |
| 55 | A funding webhook is stored raw before it is acted on, and a bad signature credits nothing. | api |
| 56 | The partner's VTpass webhook never settles an order; it only triggers a requery. | api |
| 57 | Vending starts off in every new database; only a person turns it on. The worker turns it off when the partner balance is empty. | db, worker |

## Chains (D-060 to D-062)

| # | Invariant | Test |
|---|---|---|
| 58 | Each on-chain deposit is recorded and announced once, only after the chain's confirmations, however often the indexer re-reads. | worker |
| 59 | Every settled renewal ends up in exactly one anchored batch, and its proof verifies against the published root; a changed receipt does not. | chains (property) · worker · api · browser |
| 60 | A user's chain addresses come from the identity provider, never the request; one address, one user. | api · worker |
| 61 | Nothing in the chain jobs moves a user's money. | by construction: read-only EVM client; the Stellar transaction's only operation is a no-op |

## Dollar autopay (D-063)

| # | Invariant | Test |
|---|---|---|
| 62 | The USDC charged always covers the naira price, rounded up by less than one micro-unit. | rules (property) |
| 63 | A charge never exceeds what the permission has left this period or what the account holds; both are re-read on chain just before charging. | rules (property) · worker |
| 64 | A charge nobody can confirm within 60 minutes goes to a person and freezes the line; it is re-sent, never re-signed; nothing is vended. | worker |
| 65 | A permission is accepted only for the user's own smart wallet, Constant's spender, USDC on Base, a 30-day period and an allowance within 125% of a fresh proposal, with a valid signature. | api |
| 66 | The app adds only the pinned Spend Permission Manager as an owner, whatever the server returns. | web (code) |
| 67 | Only the worker holds the spender key; the API holds its address. | config |

## Dollar guards (D-064)

| # | Invariant | Test |
|---|---|---|
| 68 | All dollar charges together never exceed the daily limit; passing it stops dollar charging until a person resets it. | rules (property) · worker |
| 69 | Money from an address that fails screening is never used; the user is frozen; an outage never counts as clear. | rules · worker |
| 70 | No USDC is taken unless the naira float covers the order plus the margin. | rules · worker |
| 71 | The app signs permissions only for the pinned spender, manager and USDC. | web (code) |
| 72 | Charged USDC doesn't stay on the hot key: one sweep at a time to the treasury, saved before sent. | worker |

## Operations, reconciliation, withdrawals, float (D-065 to D-068)

| # | Invariant | Test |
|---|---|---|
| 73 | The off-ramp never sends more USDC than the spender holds (fees included) or than the float target needs; one at a time; the sweep waits for the float. | rules (property) · worker |
| 74 | A needs_human order is settled once, by a named operator with a note, with exactly the ledger effect of its outcome. | api |
| 75 | Any reconciliation mismatch switches off vending, dollar charges and payouts. | rules · worker |
| 76 | A withdrawal goes only to a 24-hour-old account in the holder's own name; its amount is held at request and returned once, only on a definite failure. | rules · api · worker |
| 77 | Withdrawals are off until a person switches `payouts_enabled` on. | api · worker |
