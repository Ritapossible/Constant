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

---

## Stage decisions (pre-pilot, made 2026-09-29)

These answer the open questions in `PLAN.md`. They are chosen for the stage we are in: no customers yet, one founder, prove the loop and the price with the least to build. Each says what would make us revisit it.

### D-020 Pricing: a flat fee per successful buy, taken from the site balance
**₦100 per token delivered**, shown before the owner funds ("I will buy ₦15,000 each time, plus ₦100 Constant fee"). Stored as `markets.fee_per_buy_minor`, not hard-coded, so it can change per market and during the pilot.
- Why not a monthly subscription: it needs billing, dunning and a second payment each month, which the spec rules out for v1, and a subscription is a harder first "yes" than a small fee people already see on every token app.
- Why per buy: revenue only when we deliver, which is the promise. Nothing to invoice; one extra ledger line written with the vend.
- Rules: the balance must cover amount + fee; the weekly cap is in token money only, so the default cap still allows every chosen day (`decideSchedule`, INV-25). No fee on a rejected vend. A refund after acceptance refunds the fee too.
- Alert mode stays free. It is the on-ramp to schedule mode.
- **Revisit** when an owner has more than 5 sites (landlords, employers): a per-site monthly plan may suit them better. Also revisit if pilot unit economics (PLAN B2) show ₦100 does not cover SMS, WhatsApp, funding-inflow fees and support.

### D-021 First customer: Nigerians abroad paying for a family house in Lagos
The diaspora owner is the purest version of "a meter you are not standing next to".
- **Highest pain.** Parents or relatives call when the light goes. The owner cannot buy a token and walk it over.
- **Money that goes to light.** Cash sent home can be spent on something else. Constant spends only on the fixed meter, which is part of what they pay for.
- **Funding works without cards.** Remittance apps can pay out to a Nigerian bank account number, so a per-site virtual account is a destination they already know how to send to. We add no card or FX rail. We never show a foreign currency; the owner's app does the conversion before it reaches us.
- **Easy to reach.** Diaspora associations, alumni groups, church and hometown WhatsApp groups. They are used to paying for services for family back home.
- **Site phone = parent.** LOW from a parent is the product, which settles D-023.
- Constraint: IKEDC only at first, so the pilot recruits families whose house is on IKEDC. EKEDC (the rest of Lagos) is the second adapter, after IKEDC has settled real tokens for a week.
- UX consequence: owners abroad see times as "7:00am Lagos time" (UX.md).
- **Revisit** if B1 shows that diaspora owners don't fund a second time, or if Lagos landlords convert much faster in the pilot.

### D-022 Funding partner: Paystack Dedicated Virtual Accounts; Monnify is the fallback
One dedicated account number per site, issued by a partner bank under a CBN-licensed processor. Paystack has signed webhooks, a test mode, well-documented APIs, and a name owners recognise.
- **Condition before any real money:** written confirmation from Paystack that prefunded balances held for scheduled bill payment are an accepted use of dedicated virtual accounts on our account type (PLAN B3). If they say no, switch to Monnify reserved accounts (Moniepoint). Only the adapter changes.
- **Pilot exposure limit:** ops policy of at most ₦200,000 balance per site and ₦5,000,000 total float until the licence position is confirmed by a lawyer. An excess transfer is credited, and the owner is told the limit.
- **Revisit** at ~₦50m monthly volume: move to a banking-as-a-service provider where each site balance is held in a custodial structure at a licensed bank, or apply for our own licence.

### D-023 The site phone may send LOW by default
Yes, on by default. For the first segment (D-021) a parent sending LOW is the main use. The exposure is bounded by the weekly cap, the minimum gap and one open order. The owner gets one line each time ("Mum's phone asked for light. Paid ₦15,000 for meter ending 6781."). The owner can turn it off per site.

### D-024 Vend partner: VTpass for the IKEDC sandbox and pilot; BuyPower as the second adapter
VTpass has a public sandbox, electricity for all DisCos behind one API, and a transaction requery endpoint, which is our `fetch(partnerRef)`. It is quick to integrate for a single developer.
- If its callbacks are not signed, we do not trust them: settlement comes only from requery (INV-13 allows that).
- BuyPower is electricity-first and is the adapter we add for failover once volume justifies a second.
- Before signing: commission per DisCo, requery reliability, how multi-token (KCT) vends are returned, and settlement terms. These go in PLAN B2.
- **Revisit** if pending vends older than 60 minutes exceed 1% in the sandbox week.

### D-025 SMS: Termii first, Africa's Talking second
Termii for Nigeria: transactional (DND) route and sender ID registration for "Constant". Africa's Talking is the failover and becomes primary in Kenya and Ghana (EXPANSION.md). Both sit behind `Messaging`.

### D-026 Hosting: one managed platform in Europe for the pilot
A managed PaaS (Render, Frankfurt region) running `api`, `worker` and managed Postgres 16 with point-in-time recovery. One founder should not run infrastructure.
- NDPA: the privacy notice states the cross-border transfer and its basis (consent and contract). Data held: phone, meter (encrypted), transactions.
- **Revisit** before 1,000 paying sites, or earlier if a funding or vend partner requires in-country or in-Africa hosting. The next step then is AWS af-south-1 or a Nigerian data centre.

### D-027 No mobile app — *superseded by D-029*
Not in v1, and not as the next thing after v1. See PLAN "Why no app". The first owner-facing screen, when evidence asks for one, is a read-only web page reached by a one-time WhatsApp link, not a store app.

---

## Scope change: from "electricity calendar" to "prepaid autopilot" (2026-10-06)

The founder's real problem is running out without knowing: data mid-call, the meter at night. The calendar product only treated the symptom. These decisions follow from that. Details in `docs/PRODUCT.md`, `docs/SENSING.md`, `docs/ROADMAP.md`.

### D-028 Constant is a prepaid autopilot: data, airtime and electricity first
*Supersedes the "electricity only" line of the spec.* Data and airtime come first because they are fully automatable today: the phone measures usage and the network credits the bundle directly. Electricity follows on the same wallet, ledger and rules. TV, subscriptions and hardware are later phases.

### D-029 An Android app is required — *supersedes D-027*
D-027 said no app because WhatsApp could do everything the calendar product needed. Measuring data cannot be done from WhatsApp: only an app on the phone can read the phone's data usage and run a USSD balance check. Android first (most Nigerian phones). iPhone later, with fewer automatic features, because iOS allows neither. WhatsApp and SMS stay for receipts, commands and people without the app.
- Permissions: usage access (total mobile bytes only) and phone (USSD). Never SMS, contacts or per-app usage. Each permission is explained in one sentence before it is asked for.
- Native Kotlin for the sensor parts (usage stats, USSD, background work), because cross-platform frameworks wrap these poorly. The screens can be native too; one platform at a time.

### D-030 First users: people like the founder — *supersedes D-021 as first segment*
Urban Android users in Lagos with a data plan and a prepaid meter at home. They have both problems every week, and their own phone is the sensor. Diaspora owners and landlords stay as the Phase 3 "remote lines" segment.

### D-031 Pricing by product — *amends D-020*
- **Data and airtime:** sold at face value. Constant earns the partner's discount. A ₦100 fee on a ₦1,000 bundle would be 10%, which nobody accepts.
- **Electricity:** ₦100 per token delivered stays (D-020).
- **Later, Constant Plus (monthly):** family lines, spare-token float, Constant Eye rental, subscriptions. Not before Phase 3.
- Confirm partner discounts per network in PLAN B2 before launch; if the discount on data is too thin, revisit.

### D-032 What can trigger an automatic buy
A buy is triggered by a reading at or below the owner's line, from a source listed in `docs/SENSING.md` "How readings feed the rules":
- Data is only bought on a measured balance: USSD, or the usage counter with a USSD calibration under 24 hours old. Never on a forecast, because bundles expire.
- Electricity may also buy on the pessimistic forecast, only if the owner opts in, because units don't expire and early costs little while late means darkness.
- Silence never buys. Invariant 3 now reads: silence alone never creates a buy.
- All caps, the minimum gap, freeze, balance and one-open-order checks apply to every trigger.

### D-033 "Always one token ahead" for electricity
An optional mode that keeps one unkeyed token on the household's phone. When it is marked used, or a reading shows it was keyed, the next spare is bought. It covers forecast error without any hardware. It ties up one token's worth of the customer's money, and the app says so.

### D-034 Forecasts are plain statistics, not an LLM
Usage rates come from purchases and readings, with a confidence range. They decide when to ask for a reading, and (opt-in, electricity only) when to buy early. They live in `packages/rules` as pure functions with tests. Invariant: a forecast never raises a cap or an amount.

### D-035 Subscriptions, including AI tools, are Phase 4 and conditional
Naira-funded virtual cards, one per subscription, locked to one merchant and capped at its price. They need a stable licensed issuer, FX disclosure, chargeback handling, and confirmation from the issuer and each merchant's terms. This is the only product where a dollar price is shown, next to the naira charged. Until then, AI-tool renewals are out of scope.

### D-036 Hardware (Constant Eye) is Phase 4, after a software retention signal
Pulse reader, clamp, or beep detector, rented monthly, never wired into DisCo equipment. Built only once the software-only light product shows that homes keep using it.

### D-037 "Site" becomes "line" in the data model
A line is one thing that can run out: a SIM's data, a SIM's airtime, a meter, a TV decoder. Each line has an owner, an optional person at the other end, a product, a threshold, an amount, caps, a status, and readings. The electricity rules written in Phase 1 (`decideSchedule`) become one strategy among several; caps, gap, freeze and the ledger are shared.
