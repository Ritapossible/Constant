# Decisions

Short records. Newest at the bottom. A decision that changes the original build spec says so.

### D-001 Monorepo: pnpm workspaces, TypeScript, Node 22
One language across api, worker and rules; rules shared without publishing. Node 22 LTS.

### D-002 Fastify over Hono
Fastify gives raw request bytes for HMAC verification without workarounds, a mature rate-limit plugin, JSON-schema validation, and pino with path redaction. Hono would also work; this is about fewer custom parts on the webhook path.

### D-003 Money as `bigint` minor units with a currency — *renames spec columns*
Spec says `*_kobo`. We use `*_minor` plus `markets.currency` so the same schema serves GHS, KES and ZAR (all two-decimal). Arithmetic never mixes currencies: a site has one market.

### D-004 One open order per site — *adds to spec*
The spec debits the ledger at partner acceptance and sets `last_buy_at` at settlement. Between "vend call sent" and "accepted", neither has moved, so a LOW could pass both the balance and min-gap checks and buy a second time. `decideSchedule` now takes `hasOpenOrder` and returns `in_flight`; Postgres backs it with a partial unique index on open orders and a `FOR UPDATE` lock on the site row.

### D-005 `next_run_at` advances when the order is created — *clarifies spec*
Spec: "after each settled buy it sets next_run_at". If we waited for settlement, a slow vend leaves the site due and the scan re-evaluates it every minute. Advancing in the same transaction that inserts the order means the slot is consumed exactly once. A definitive vend failure tells the owner; they can send LOW.

### D-006 Stale runs: same local day or not at all — *makes "no catch-up" precise*
A due run is bought if the scan reaches it on the same local calendar day in the site's zone. If the worker was down all Monday, Monday is skipped and the owner is told once ("Monday's ₦15,000 did not run"). Otherwise an outage becomes a surprise late-night purchase.

### D-007 The next run after any buy respects the minimum gap — *adds to spec*
`nextRunAfterBuy` picks the next chosen morning after the buy's local day and, if that is inside `min_hours`, the one after. Otherwise a LOW on Sunday at 15:00 turns Monday 07:00 into `too_soon`, and Monday is silently lost.

### D-008 Extra do-not-buy reasons
Spec reasons plus `not_due`, `stale`, `skipped`, `in_flight`, `misconfigured`. The SQL scan already filters most of these; checking them again in the pure function is defence in depth and keeps the rules testable without a database.

### D-009 Commands forgive whitespace and one trailing "." or "!"
Still exact words and case-insensitive. Phones auto-punctuate; "Stop." must freeze.

### D-010 Unit readings reject more than six integer digits
Superset of the spec's 11–13 digit rule. Also rejects tokens and phone numbers of any length.

### D-011 Soroban mandate is not scheduled — *changes build order*
It adds cost, regulatory surface and a second source of truth, and no customer asked for it. The `Attestor` interface stays so it can be added if a partner or auditor needs independent proof of caps. Invariant 15 stays in the list, marked not applicable.

### D-012 `meter_hmac`, not `meter_hash` — *renames spec column*
A plain SHA-256 of an 11–13 digit meter number is reversible by enumeration. HMAC under `METER_HMAC_KEY`, separate from the encryption key.

### D-013 Markets from day one, one market enabled
`markets` table holds currency, zone, locale, enabled rails. All rule functions take the zone as input. Only `NG` is enabled. No second DisCo until IKEDC has settled real sandbox tokens for a week (spec).

### D-014 Funding is a rail, not always a virtual account
The Funding interface returns what to show the owner (`FundingDisplay`): a bank + account number in Nigeria, a paybill + account number in Kenya, a MoMo reference in Ghana. The rule does not change: one funding identity per site, never pooled.

### D-015 A vend may return more than one token
After tariff or key changes (e.g. the STS key-revision rollover), a vend can return key-change tokens that must be entered before the credit token. `order_tokens` stores an ordered list; the SMS lists them in order ("Key in 1 of 3 …").

### D-016 The owner hears about every site-phone LOW and SKIP
The site phone can spend (LOW) and cancel (SKIP). The owner gets one line each time. `site_phone_can_low` lets the owner switch LOW off for the premises.

### D-017 pg-boss for scheduling and jobs
The scan is a pg-boss schedule with singleton semantics. Order insert and job enqueue share one transaction.

### D-018 Reconciliation kill switch is a database flag
`system_flags.vending_enabled`, read inside every decide transaction and passed to `decideSchedule`. Clearing it is a logged human action.

### D-019 SMS uses GSM-7 text; "₦" only on WhatsApp and the receipt page
"₦" is not in the GSM-7 alphabet. One such character switches an SMS to UCS-2, which cuts a segment from 160 to 70 characters and can triple the cost of every token message. SMS copy writes `N15,000`; WhatsApp and the web write `₦15,000`. Test: every SMS template renders to one GSM-7 segment.
