# PLAN

What to build next and in what order. The long view is in `docs/ROADMAP.md`; the product is in `docs/PRODUCT.md`; how we know what's left is in `docs/SENSING.md`.

Two tracks run together. The engineering track makes refills automatic and safe. The business track proves people want them and will keep paying. Neither waits for the other.

Status: ✅ done · 🔜 next · ⬜ not started

## Engineering track

Each step ends with its exit test passing in CI. No real money moves until the money-path steps (3, 4, 9) are green.

### 1. Rules and invariant tests (electricity, calendar) ✅
`packages/rules`: `decideSchedule`, `scanAction`, `decideAlert`, `parseUnits`, commands, order state machine, funding, price check, reconciliation, idempotency keys, time zones, per-buy fee.
**Exit:** every rules-level invariant has a passing test, including property tests on money. *127 tests passing.*

### 2. Rules for lines, readings, thresholds, pots 🔜
*Done so far:* `forecast.ts` (running-low probability, run-out window, reminders, wallet runway), `decideWithdrawal`, and `refill.ts` (`decideDataRefill`, light forecast confidence, supply-hour rates, `decideSpareToken`), with tests (D-040 to D-049). *173 tests passing.*

Still to do:
Generalise to lines (D-037) without weakening anything in step 1.
- `Reading { source, value, at }` and `decideRefill`: buy when a trusted reading is at or below the line, per the source table in SENSING.md (D-032). Data needs a USSD calibration under 24h; forecasts never buy data.
- `estimateRemaining`: data = last calibration − bytes used since, plus bundles bought since. Electricity = last reading + units bought − rate × time, with a pessimistic bound.
- `whenToAsk`: the next time to ask for a meter reading, from the forecast.
- Spare-token rules (D-033): exactly one spare outstanding; the next is bought only when the spare is marked used.
**Exit:** property tests: no buy above caps; no data buy from a forecast; silence never buys; a forecast never raises an amount; at most one spare outstanding.

### Next build: one bill, end to end ✅ code · 🔜 go live
From the 2026-10-10 review: before any new screen, take **one** bill all the way through on a server: a DSTV renewal or a data top-up that spends real money and delivers the result to the owner. It uses the thin slice of steps 3, 4, 7, 9 and 10 that one line needs. The app keeps its "Preview" badge until this works.
*Done (D-057 to D-059):* cable TV renewals. `decideRenewal`; Postgres schema with append-only ledger and one open order per line; VTpass, Paystack, Privy, Resend/Termii adapters with fakes; worker (scan, vend, requery, needs_human, recovery, notices); API (`/v1`, webhooks); the app's Cable TV flow and naira account. 294 tests including concurrency and crash cases on a real Postgres.
*Left:* accounts, keys and the sandbox run in `docs/GO-LIVE.md`. Then data top-ups on the same rails.

### Chains: Base, Arc, Stellar ✅ first step · 🔜 dollar autopay
*Done (D-060 to D-062):* `packages/chains` (verified chain facts, deposit reader, Merkle proofs, Stellar anchoring); users' addresses from Privy; deposit indexer for USDC/USDT on Base and USDC on Arc with notices; public receipts anchored hourly on Stellar and checked in the browser. Live-checked on Base, Arc and Stellar testnet.
*Next:* spend permissions per line on Base (Privy smart wallet), charge-then-vend with the naira float, Paycrest off-ramp, Arc treasury via CCTP. Needs the crypto legal opinion (B12) before real users.

### 3. Schema, ledger, fake partners, double-submit ⬜
`packages/db`: owners, lines, readings, orders, order_tokens, ledger (append-only), funding, notices. One open order per line. `FOR UPDATE` decide transaction.
`packages/partners`: `Vending` (electricity, data, airtime), `Funding`, `Messaging`, `Push`; fakes for each.
**Exit:** 50 concurrent triggers on one line produce exactly one order; a replayed funding webhook credits once; ledger sum equals the cached balance.

### 4. Refill worker ⬜
`apps/worker`: threshold scan, schedule scan, vend, fetch retries, notify, crash recovery.
**Exit:** both crash cases (partner ref saved / not saved); SMS failure resends the stored token; pending neither settles nor refunds; a data bundle is credited once.

### 5. Android sensor spike (in parallel with 2–4) ⬜
`apps/android` (Kotlin): usage-access permission, mobile bytes since a moment, USSD balance on MTN, Airtel, Glo and 9mobile with recorded-reply parser tests, background schedule that survives battery savers on Tecno, Infinix, Itel and Samsung.
**Exit:** ROADMAP Phase 0 gate: estimate within 10% of the network's balance on 9 of 10 checks.
From review (D-045, D-046): show the raw USSD reply next to the byte count, record which codes answer in one reply on each network, let testers share the network's balance SMS or a screenshot into the app, upload every raw reply as a parser test fixture, and note night/social/WhatsApp-only bundles and dual-SIM behaviour. Alongside it, the light concierge homes photograph the indoor keypad (D-047).

### 6. Android app v1: pots, cable, data and airtime autopilot ⬜
Sign-in by phone number (OTP), account funding details, pots, covered-until screen, withdraw/cancel/pause/reschedule, cable TV renewal, running-low reminders, payday plan, data-left screen, "time at your pace", line and cap settings, freeze, receipts, push. Calls the API; never decides a buy on the device.
**Exit:** dogfood for 2 weeks by the founder and 20 testers without running out; no unexplained ledger line.

### 7. API: app, WhatsApp, SMS, webhooks ⬜
`apps/api`: app endpoints (readings in, lines, wallet), WhatsApp and SMS commands (STOP, START, LOW, SKIP, BALANCE, DONE), funding and vend webhooks, receipt page.
Also (D-054, `docs/DELIVERY.md`): Telegram bot (webhook with secret token, one-time-code linking, same commands plus TOKEN), email delivery and PDF receipts, per-person channel choice, and the fallback rule `nextDeliveryStep`.
`packages/copy`: English, then Pidgin.

### 8. Light in the app ⬜
Meter onboarding (wave-1 DisCos per D-038, each behind its gate), photo reading read on the phone, typed reading, forecast and ask-when-near prompts, buy on reading, spare token, optional buy-early, calendar and alert modes, token delivery with DONE.
**Exit:** in the 10 concierge homes, no surprise outage with the spare-token mode on.

### 9. Reconciliation and kill switch ⬜
Nightly and on demand; a mismatch turns off all buying; ops clearing is logged.

### 10. Real partners, one line each ⬜
VTpass sandbox, then live, for one data line, one airtime line and one meter. Paystack virtual accounts.
**Exit:** a week of clean reconciliation.

### Later (ROADMAP Phases 3–5)
Remote and family lines, iPhone, TV renewals, grid-aware forecast, Constant Eye hardware, AI and other subscriptions on merchant-locked cards, DisCo and network partnerships, new countries. Not started until the gates in ROADMAP are met.

### Not scheduled
Soroban mandate (D-011). Money rails for Base, Arc and Stellar are designed in `docs/RAILS.md` (D-051).

## Business track (start now)

| # | Task | Why | Output |
|---|---|---|---|
| B1 | **Data sensor test** with 20 Android users across four networks (ROADMAP Phase 0). | Proves the core automation is accurate. | Accuracy table per network and phone model. |
| B2 | **Unit economics**: VTpass discount per network for data and airtime, and per DisCo for electricity; funding inflow fees; SMS, push and WhatsApp costs. | Confirms D-031 pricing. | Spreadsheet; keep or change pricing. |
| B3 | **Light concierge** with 10 homes: forecast-timed photo requests and the spare-token habit. | Proves "near-automatic" light. | Outages before vs after; keying time. |
| B4 | Open VTpass and Paystack accounts. Get written confirmation (and a lawyer's opinion) that deposits held in pots, paid out to bills and **withdrawable at any time** are covered by the partner's licence; agree identity-check tiers. | The legal basis of holding money people can withdraw (D-040). | Signed terms; sandbox keys; written opinion. |
| B5 | NDPC registration, privacy page, terms; Google Play data-safety form for usage access and USSD. | Required to launch the app. | Published pages; approved listing. |
| B6 | SMS sender ID, WhatsApp Business verification, template approvals. | They take weeks. | Approvals. |
| B7 | **Bundle stacking map**: which plans add to an active bundle on each network. | The autopilot must only buy plans that add. | A table in `docs/SENSING.md`. |
| B8 | Start conversations with one wave-1 DisCo (IKEDC or EEDC) and one meter maker about smart-meter balance and remote loading. | Phase 5 takes 12+ months to arrange. | A named contact and a written next step. |
| B9 | **Card-issuing partner** for subscriptions: shortlist licensed issuers, confirm merchant-locked single-use funding, FX rules, chargebacks. | Decides whether subscriptions ship in Phase 3. | Signed term sheet or a clear no. |
| B11 | **Wallet on Android and spend permissions**: Privy is the account layer (D-056); confirm its React Native SDK and smart-wallet spend-permission support on Base; decide native Kotlin + web view, or React Native with Kotlin sensor modules. | Decides the app stack for the dollar path (RAILS). | A one-page decision. |
| B12 | **Crypto legal opinion**: stablecoin deposits and off-ramp for Nigerian users (ISA 2025, SEC Nigeria digital-asset rules); Paycrest's licence and KYC split in writing. | Required before any dollar goes live. | Written opinion. |
| B13 | **CIU balance-code guide**: record the balance code and screen for each keypad brand seen in the pilot homes. | Tells households what to photograph (D-047). | A verified table. |
| B14 | **Delivery set-up**: Telegram bot name and handle ("Constant"), WhatsApp templates (`token_ready`, `renewed`, `running_low`, `wallet_short`), email domain with SPF/DKIM/DMARC and a transactional email provider. | Every channel works on day one. | Bot live, templates approved, domain verified. |
| B10 | **DisCo gate runs**: sandbox lookups and test vends for EKEDC, EEDC and AEDC. | Wave-1 coverage. | A filled gate checklist per DisCo. |

## Decisions in force

| Question | Decision | Record |
|---|---|---|
| What Constant is | Prepaid autopilot: data, airtime, electricity first | D-028 |
| App | Android app required (sensor); iPhone later; WhatsApp and SMS stay | D-029 (supersedes D-027) |
| First users | Urban Android users with data plans and a prepaid meter; data nationwide, light DisCo by DisCo | D-030, D-038 |
| DisCos | Data rows, gated one by one; wave 1: IKEDC, EKEDC, EEDC, AEDC | D-038 |
| Pricing | Data and airtime at face value; ₦100 per electricity token; Plus later | D-031, D-020 |
| What triggers a buy | Trusted reading at the line; data never on forecast; silence never | D-032 |
| Electricity buffer | Optional spare token | D-033 |
| Money | One account per user, pots per line; cancel, pause, reschedule, withdraw any time | D-040 |
| Cable TV | DSTV, GOtv, StarTimes renew before expiry; Phase 1 | D-041 |
| Running low | Probability reminders (≥60%, 1/day/line, quiet hours) and wallet runway | D-042, D-043 |
| Ideas backlog | `docs/IDEAS.md`, enters PLAN by phase | D-044 |
| Data reality | Unknown is never low; main balance only; SIM chosen; stacking known; estimate buys opt-in | D-045, D-046 |
| Light reality | Read the indoor keypad; forecast per grid hour with one-tap supply; confidence levels; spare timing | D-047 to D-049 |
| Pilot homes and marketing | Pilot homes where the founder can visit them; "withdraw any time" marketed only after the partner's letter | D-050 |
| Developer platform | Public API, webhooks and SDKs on the same rails, after the app is stable | D-055, ROADMAP Phase 6 |
| Delivery | User picks WhatsApp, Telegram, SMS or email; fallback ends in SMS; same stored token every time | D-054, `docs/DELIVERY.md` |
| Money rails | Naira via Paystack; dollars on Base (OTP embedded wallet, spend permission per line, Paycrest off-ramp); Arc treasury; Stellar later; no Agent Stack | D-051 to D-053, `docs/RAILS.md` |
| Forecasting | Plain statistics, bounded, tested; no LLM | D-034 |
| AI and other subscriptions | Monthly auto-renewal on merchant-locked cards; Phase 3 if a card issuer is signed | D-039 (amends D-035) |
| Hardware | Phase 4, rented, after a retention signal | D-036 |
| Funding partner | Paystack virtual accounts, Monnify fallback | D-022 |
| Vend partner | VTpass (data, airtime, electricity), BuyPower second | D-024 |
| SMS | Termii, Africa's Talking failover | D-025 |
| Hosting | Managed PaaS, Frankfurt, PITR | D-026 |

## Not now

Buying data on a forecast. Reading SMS, contacts or per-app usage. Wiring into or touching DisCo meters. Card payments into the wallet. A web dashboard. Any chain. An LLM on the money path. Hardware before the light product retains. Subscriptions before a stable card-issuing partner.
