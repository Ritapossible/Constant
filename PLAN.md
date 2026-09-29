# PLAN

Two tracks run together. The engineering track makes the loop correct. The business track proves people will pay for it. Neither waits for the other.

Status: ✅ done · 🔜 next · ⬜ not started

## Engineering track

Each step ends with its exit test passing in CI. No step starts real money until every step before it is green.

### 1. Rules and invariant tests ✅
`packages/rules`: `decideSchedule`, `scanAction`, `decideAlert`, `parseUnits`, `parseCommand`/`routeInbound`, the order state machine, funding and reversal decisions, the price check, reconciliation, idempotency keys, and time-zone scheduling.
**Exit:** every rules-level row in `docs/INVARIANTS.md` has a passing test, including property tests on money. *127 tests passing.*

### 2. Schema, ledger, fake vend, double-submit 🔜
`packages/db`: migrations for the model in ARCHITECTURE, the append-only ledger (DB trigger rejects UPDATE/DELETE), repositories, `FOR UPDATE` decide transaction, partial unique index for one open order.
`packages/partners`: `Vending`, `Funding`, `Messaging` interfaces, `FakeVending` (deterministic token from order id, configurable accept/pending/reject/timeout), `FakeFunding`.
**Exit:** tests against real Postgres (testcontainers or CI service): 50 concurrent LOWs plus a scan on one site produce exactly one order; replaying a funding webhook credits once; ledger sum equals cache.

### 3. Schedule scan and vend worker ⬜
`apps/worker`: pg-boss scan, vend job, fetch retries, notify job, crash recovery on start.
**Exit:** crash after `partner_ref` saved → one vend. Crash before → no second vend, `needs_human`, site frozen. SMS failure resends the stored token. Pending neither settles nor refunds. Multi-token vend stored in order.

### 4. WhatsApp and SMS for a seeded site ⬜
`apps/api`: signature checks, raw payload stored first, `routeInbound`, commands (LOW, SKIP, STOP, START, BALANCE), owner notices, receipt page.
`packages/copy`: English templates, length and encoding tests, banned-word guard.
**Exit:** seeded site buys when the clock says so, LOW buys early, SKIP skips once, STOP freezes; receipt URL and HTML contain no 20-digit token.

### 5. Onboarding and fake funding ⬜
One question per message; meter name confirmation; funding details per site.
**Exit:** one owner with five sites, separate balances; one site cannot spend another's money.

### 6. Alert mode ⬜
**Exit:** an alert site, flooded with readings and LOWs, never creates an order, a ledger vend, or a partner call.

### 7. Real IKEDC sandbox, one meter ⬜
Real vend and funding adapters behind the same interfaces.
**Exit:** a week of sandbox tokens with clean reconciliation; multi-token case exercised if the sandbox supports it.

### 8. Reconciliation and kill switch ⬜
Nightly and on-demand; mismatch sets `vending_enabled=false`; ops clearing is logged.
**Exit:** injected mismatch stops every buy within one scan.

### 9. Pilot: one owner, two real meters, a human watching ⬜
**Exit:** two weeks, zero unexplained ledger lines, every token delivered, owner renews funding without being asked.

### Not scheduled
Soroban mandate (D-011). It needs a customer, partner or auditor reason first.

## Acceptance (end of step 6, all on fakes)

- Seed a schedule site: Monday, ₦15,000, balance ₦50,000, min gap 20h. Send nothing. When due: one token stored, balance ₦35,000.
- Scan again immediately: no second vend.
- A silent week: next Monday still buys.
- LOW inside the gap: no buy. LOW after the gap: one buy, next run moves forward past the gap.
- SKIP then the due scan: no buy; the run after that buys.
- STOP then a due scan: no buy.
- Short balance: no vend, one notice, not a loop.
- Alert site, send 10: owner notified, no order, no ledger vend.
- Crash after `partner_ref` saved: one vend. Crash before: no second vend, `needs_human`.
- Pending does not settle and does not refund.
- Receipt URL has no 20-digit token.
- No customer-facing string contains USDC, XLM, wallet, or a dollar amount.

## Business track (start now, in parallel)

| # | Task | Why | Output |
|---|---|---|---|
| B1 | Manual pilot with 10 owners for 4 weeks: you buy on their days and text the token. | Proves demand and the price before the code is finished. | Retention: how many funded a second time. |
| B2 | Unit economics per vend: partner commission, funding inflow fee, SMS ×2, WhatsApp templates, support minutes. | Confirms ₦100 (D-020) covers cost. | A spreadsheet; keep or change the fee. |
| B3 | Open accounts with VTpass (D-024) and Paystack (D-022); get written confirmation that prefunded balances are an accepted use. | Regulatory basis of the company. | Signed terms; sandbox keys. |
| B4 | NDPC registration, privacy page, terms. | Legal to hold phone and meter data. | Published pages. |
| B5 | Register the "Constant" SMS sender ID; WhatsApp Business verification; template approvals. | These take weeks and block step 4 going live. | Approved IDs and templates. |
| B6 | ~~Pick the first segment~~ Decided: diaspora family houses in Lagos (D-021). Recruit the 10 pilot owners. | Different channels and funding needs. | 10 owners, IKEDC meters confirmed. |
| B7 | Pidgin copy by a native speaker. | Reach at the site phone. | `packages/copy/pcm`. |

## Not in v1

Meter reading or OCR. Buying because nobody replied. Data, airtime, TV. Card payments. Mobile app, web dashboard, wallet, chain picker. Any second chain or bridge. Paying a meter number read from a message. Holding customer money in a personal account. Subscription billing. Diaspora payouts. An LLM on the money path. Auto-tuning the schedule. A second DisCo before step 7 has run clean for a week.

## Why no mobile app (D-027)

Everything the product needs already works without one:

- **The site phone must be SMS anyway.** The person keying in the token may have a basic phone, no data, or a shared handset. An app cannot replace that step.
- **The owner acts a few times a month.** Set once, fund occasionally, sometimes LOW, SKIP or STOP. WhatsApp handles that with nothing to install, on any phone, from any country.
- **An app costs more than it returns at this stage:** two platforms, store review, updates, push setup, login and account recovery, device security, and install drop-off, often worse for data-conscious users. It would take months that belong to the money path and the pilot.
- **Trust comes from the token arriving,** not from a screen. A new fintech app asking for money is a harder "yes" than a WhatsApp chat that just works.

What would change this, in order:

1. Owners ask to see history across sites (more than 1 in 5 pilot owners asks unprompted) → a **read-only web page** opened from a one-time WhatsApp link. No password, no install.
2. Landlords or employers with 10+ meters need to manage them in bulk → the same web page gets edit actions, still behind WhatsApp login.
3. A native app only if a feature needs the phone itself (e.g. contacts-free sharing, offline token wallet for the site phone) and the web page has proven demand.

## Decisions taken (were open questions)

| Question | Decision | Record |
|---|---|---|
| Fee model | ₦100 per token delivered, from the site balance; alert mode free | D-020 |
| First segment | Diaspora owners paying for a family house in Lagos (IKEDC) | D-021, `docs/GO_TO_MARKET.md` |
| Funding partner | Paystack Dedicated Virtual Accounts, Monnify fallback, conditional on written confirmation (B3) | D-022 |
| Vend partner | VTpass (sandbox and pilot), BuyPower second | D-024 |
| SMS | Termii, Africa's Talking failover | D-025 |
| Site phone LOW by default | Yes, owner told every time, switchable | D-023 |
| Hosting | Managed PaaS, Frankfurt, PITR; revisit at 1,000 sites | D-026 |
| Mobile app | No | D-027 |
