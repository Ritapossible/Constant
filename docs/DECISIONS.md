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

### D-022 Funding partner: Paystack Dedicated Virtual Accounts; Monnify is the fallback — *amended by D-040 (one account per user, pots inside)*
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

### D-035 Subscriptions, including AI tools, are Phase 4 and conditional — *amended by D-039*
Naira-funded virtual cards, one per subscription, locked to one merchant and capped at its price. They need a stable licensed issuer, FX disclosure, chargeback handling, and confirmation from the issuer and each merchant's terms. This is the only product where a dollar price is shown, next to the naira charged. Until then, AI-tool renewals are out of scope.

### D-036 Hardware (Constant Eye) is Phase 4, after a software retention signal
Pulse reader, clamp, or beep detector, rented monthly, never wired into DisCo equipment. Built only once the software-only light product shows that homes keep using it.

### D-037 "Site" becomes "line" in the data model
A line is one thing that can run out: a SIM's data, a SIM's airtime, a meter, a TV decoder. Each line has an owner, an optional person at the other end, a product, a threshold, an amount, caps, a status, and readings. The electricity rules written in Phase 1 (`decideSchedule`) become one strategy among several; caps, gap, freeze and the ledger are shared.

### D-038 Electricity is nationwide; DisCos are data, enabled one by one — *corrects the IKEDC-only assumption*
IKEDC serves only part of Lagos. EKEDC serves the rest of Lagos, EEDC serves Enugu and the South-East, and every other region has its own DisCo. Data and airtime work nationwide from day one, so electricity has to as well, or most users can only use half the product.
- DisCos are rows in a `utilities` table (code, name, states served, vend product id, enabled), never constants in code. Names and boundaries change: since the Electricity Act 2023, some states are setting up their own regulators and distribution arrangements.
- The vend partner (VTpass) sells for all DisCos through one API, so adding a DisCo is configuration plus testing, not a new adapter.
- **Gate per DisCo** before it is enabled for customers:
  - meter lookup returns a name;
  - a sandbox or live test vend settles;
  - units are returned with the token;
  - multi-token (key change) handling is seen or documented;
  - requery works.
  Then 50 real vends with clean reconciliation before it is advertised.
- First wave: IKEDC and EKEDC (Lagos), EEDC (Enugu and the South-East), AEDC (Abuja). Then IBEDC, PHED, BEDC, KEDCO, KAEDCO, JED, YEDC and Aba Power, in order of where users sign up.
- Users on a DisCo that isn't enabled yet still get data, airtime and alert-only for light, and join a waitlist for that DisCo.

### D-039 Subscriptions, including AI tools, move up to Phase 3 — *amends D-035*
The trigger is easy: a subscription renews on a known date every month, so this is date-based, like TV, with no sensing at all. Constant tops up the subscription's card a day before renewal; the merchant charges it; Constant confirms and sends a receipt. If the wallet is short, the owner is told three days ahead, not on the day.

The hard part is the payment rail, not the automation. Paying ChatGPT, Claude or Gemini needs a card that works with foreign merchants, funded from naira. Design:
- one virtual card per subscription, locked to that merchant and capped at that month's price plus a small FX margin;
- the card is funded only for the renewal, and holds zero otherwise;
- the naira amount and the dollar price are both shown, with the rate used.

Moved to Phase 3, alongside TV, **only if** a licensed card-issuing partner is signed by then (PLAN B9). Without one it stays in Phase 4. Also check each merchant's terms, chargeback handling and the issuer's FX rules.

## The product is "set it once, never think about it again" (2026-10-06)

### D-040 Money set aside in pots; cancel, reschedule, pause or withdraw at any time — *amends D-022*
One Constant account per user, funded by bank transfer into the user's own account number, instead of one virtual account per site. Inside it, a **pot** per line (DSTV, Light, Data, ChatGPT…).
- A pot pays only its own line. Moving money between pots needs the user's explicit permission, every time.
- Cancel returns the pot to the main balance. Pause and reschedule move or stop the next payment.
- Withdraw to a bank account in the user's own verified name at any time. Money committed to an open order is the only part that can't be withdrawn (`decideWithdrawal`, INV-36). Payouts stop with the same kill switch as vending.
- Consequence: Constant now holds money people can withdraw. That is stored value, which is regulated. The funding partner's licence must cover deposits, pots and withdrawals; identity checks (BVN/NIN tiers) apply as balances grow; the money is never in an account owned by the company or its staff (PLAN B4).

### D-041 Cable TV is a Phase 1 product
DSTV, GOtv and StarTimes renew on a known date, are sold through the same vend partner, and are credited directly to the decoder. Nothing to sense, no token to key in: the simplest fully automatic product, and a strong first proof of the pots and the money path.
- Decoder lookup shows the name, plan and expiry; nothing is paid before the user confirms.
- Renew the same plan the day before expiry. Plan changes apply from the next renewal.
- A provider price rise above the user's cap is asked about once, never paid silently.
- Showmax and other streaming are subscriptions (D-039), not cable.

### D-042 Running-low probability reminders
For every line, `packages/rules/src/forecast.ts` computes the probability of running out within the next 48 hours from the line's daily usage (mean and spread), plus a cautious date (20%) and a likely date (50%).
- Remind at 60% or more, at most once per line per 24 hours, never between 22:00 and 07:00 local time. All of these are settings with those defaults.
- If autopilot and the pot cover it, the reminder is a heads-up; otherwise it asks the user to act.
- Fewer than 3 days of history: "still learning", never a made-up number.
- Statistics only (D-034). A reminder never moves money.

### D-043 Wallet runway: warn before a renewal fails for lack of money
`walletRunway` walks all upcoming renewals (scheduled) and refills (estimated) in date order against the money set aside. It names the first one that would fail and by how much. Sent with the payday reminder and at least 3 days before a shortfall.

### D-044 Ideas backlog lives in `docs/IDEAS.md`
Ideas are scored by effort, risk and phase. They enter PLAN only when their phase arrives and their evidence exists. This stops scope creep while keeping good ideas visible.

## Field realities and money rails (2026-10-06, after review in `docs/REVIEW-2026-10-06.md`)

### D-045 Data: unknown is never low — *amends D-032 and INV-27*
USSD often answers with a menu or "you will receive an SMS". Android's `sendUssdRequest` gets one reply only. So:
- A failed, menu or SMS-deferred reply never updates the balance and never triggers a buy.
- Network parsers extract the **main** data balance only. Night, social and app-only bundles are excluded.
- The user picks the SIM on dual-SIM phones.
- Auto-buy only plans known to add to an active bundle (stacking map, PLAN B7). Otherwise ask.
- Buy automatically on a network reading under 24 hours old. On the phone's count alone, buy only if the owner opted in, and label it estimated. Otherwise ask with one tap. (`decideDataRefill`)

### D-046 Data calibration without reading SMS
When a network won't return the balance in one USSD reply: the user can **share** the network's balance SMS to Constant from their SMS app (Android share sheet; no SMS permission), share a **screenshot** of the network's own app (read on the phone), or **type** it. Each counts as a calibration with its source recorded.

### D-047 Light: read the indoor keypad (CIU)
Most prepaid meters in Nigerian homes are split: the measuring unit is outside, the keypad with the balance is inside. Onboarding asks for the meter brand. The app shows that brand's balance code from a guide kept as data. Codes are added only after they are seen working in the pilot, never guessed. A photo whose number looks like a meter number (11–13 digits) is rejected.

### D-048 Light forecasts count grid hours, and say how sure they are
- Usage is measured per hour of grid supply, from units on vend receipts (after any debt deduction) and readings.
- Expected supply starts from the meter's NERC band minimum (A 20h, B 16h, C 12h, D 8h, E 4h). It is replaced by the household's one-tap answer: "Was there light yesterday: morning, afternoon, night?"
- Confidence: under 2 readings say "still learning"; under 4 readings or 7 days say "about Thursday, from 3 readings" with no percentage; after that, the probability may be shown. (`lightForecastMode`, `unitsPerSupplyHour`, `expectedSupplyHoursPerDay`, `daysOfLightLeft`)

### D-049 Spare token timing
Buy the spare when the cautious run-out is 3 days or less away. Only one at a time. No buy-early while a spare waits. Remind the household to key it in after 14 days, because old tokens can be rejected after key changes and meters can refuse credit above their maximum. (`decideSpareToken`)

### D-050 Pilot homes and a marketing gate (from review)
- The light concierge homes are chosen where the founder can visit them, on whichever DisCo that is. The DisCo plan (D-038) is unchanged.
- "Withdraw any time" is not advertised until the funding partner's written confirmation (B4) is signed. The feature itself is unchanged (D-040).

### D-051 Money rails: Base for users, Arc for treasury, Stellar later — *amends D-011*
Full design and sources in `docs/RAILS.md`.
- **Accounts:** phone/email OTP via CDP Embedded Wallets, an ERC-4337 smart account on Base, gas sponsored.
- **Dollar deposits:** USDC or USDT on Base only.
- **Automatic charging:** a spend permission per line, at most a stated dollar amount per period. Charge on chain first, vend from a prefunded naira float, off-ramp via Paycrest on Base to replenish.
- **Arc:** treasury and settlement. USDC-only deposits for Arc holders, bridged with CCTP.
- **Stellar (Phase 3):** an optional Soroban cap and audit trail per line, plus Stellar USDC deposits via CCTP, fully sponsored.
- **The naira path is unchanged.**

### D-052 No Circle Agent Stack, no x402
Those are for AI agents paying for services. Constant is a person approving a capped bill, and no model is on the money path.

### D-053 Chain words appear only where the user is handling dollars — *amends CLAUDE.md rule 10*
"USDC", "USDT", "Base" and an address appear only on the Add dollars and Withdraw dollars screens, and in dollar receipts for that user. Never in SMS, never to the person at the premises, never to naira-only users.

### D-054 Deliver tokens and messages on the user's chosen channel: WhatsApp, Telegram, SMS or email
Each person picks and orders their channels.
- A token is sent on the first linked channel. If it fails, or isn't confirmed within 5 minutes, the next one is tried. SMS is always the last resort for a token.
- Every attempt resends the same stored token. Delivery never buys again.
- Telegram is linked only by a one-time code from the app, because Telegram doesn't share phone numbers.
- Email never carries the token in its subject.
- Rule: `nextDeliveryStep` in `packages/rules/src/delivery.ts`. Details: `docs/DELIVERY.md`.

### D-055 A developer platform is on the roadmap (Phase 6)
Constant's rails (bill payments, autopay, forecasts, delivery, stablecoin autopay on Base and Arc) will be opened to other developers through a versioned API, webhooks and SDKs once our own app is stable. Every call goes through the same `packages/rules`, ledger and caps; no API bypasses them. Gate and order in `docs/ROADMAP.md` Phase 6. This expands IDEAS F5.

### D-056 Privy for sign-in and embedded wallets — *amends D-051 (account layer)*
The app uses Privy: Google, email, SMS, passkey and wallet sign-in, and a self-custodial embedded Ethereum wallet created for anyone who doesn't sign in with a wallet (`createOnLogin: users-without-wallets`).
- Supported chains: Base and Arc mainnet (chain 5042, `rpc.mainnet.arc.io`).
- Accepted stables match INV-46: USDC and USDT on Base, USDC on Arc.
- Replaces CDP Embedded Wallets as the account layer. Spend permissions for scheduled charges (RAILS) are still planned on a smart account. Before the dollar path goes live, confirm Privy's smart-wallet support for ERC-4337 spend permissions on Base (PLAN B11).
- `/app` is a working preview:
  - Real sign-in and real on-chain balances.
  - Bills, readings, forecasts and reminders computed by `packages/rules`.
  - The plan is stored on the user's device until the backend (PLAN steps 3–4) exists.
  - Bills are not paid until the licensed partner is live.

### D-057 The first real bill is cable TV — *from the 2026-10-10 review*
One bill, stored on a server, that spends money and delivers a result, before any new screen. Cable TV (DSTV, GOtv, StarTimes) goes first because it needs no sensor and no token (D-041).
- **Rule:** `decideRenewal` in `packages/rules/src/renewal.ts`. The amount is always the provider's fresh lookup price, never the client's. A price above the user's limit is asked about once (INV-39), never paid.
- **Timing:** renew at 07:00 Lagos the day before the plan ends. If the lookup shows the plan already runs more than 3 days, someone renewed it elsewhere: move the run, pay nothing (INV-51).
- **Retries:** short money or a price above the limit is told once per cycle and rechecked hourly, so money added later the same day still renews. A failed payment is retried after 2 hours; 3 failures in a cycle pause the line and page a person.
- **Fee:** none. Cable is sold at face value like data and airtime (D-031); Constant earns the partner's commission. The fee table is data (`fees`), so this can change.

### D-058 Orders are the queue; money is held, not debited, while a renewal is in flight — *amends ARCHITECTURE (pg-boss)*
- The `orders` and `notices` tables are the work queues. The worker claims rows with row locks. Creating an order and queueing it is one insert in one transaction, which is what pg-boss was chosen for, without a second schema to run.
- The vend and fee ledger entries are still written once, at delivery (INV-13). Until then the order's amount is **held**: available = ledger sum − open orders without a vend entry (`availableBalance`, INV-52). A user with two bills due the same morning can't spend the same naira twice.
- VTpass's request id is the partner reference. It is saved on the order before the call, so a crash can always be asked about (INV-8). VTpass webhooks are unsigned, so they only trigger an immediate recheck; settlement comes from the requery (rule 6).

### D-059 Hosting: Render, Frankfurt — *implements D-026*
API (web service), worker (background worker) and Postgres 16 on Render in Frankfurt, from `render.yaml`. The web app stays on Vercel and calls the API with the user's Privy access token. Steps: `docs/GO-LIVE.md`.

### D-060 Base and Arc: users' own addresses, watched server-side — *implements D-051, D-056 (first step)*
- The server learns each user's EVM addresses from Privy's API (embedded and linked wallets), never from the browser. An address belongs to one user only.
- The worker reads USDC and USDT transfers into those addresses on Base (12 confirmations) and USDC on Arc (final in under a second), records each once (`chain_deposits`), and tells the user. The money stays in the user's own account: nothing is credited to the naira ledger, nothing is moved.
- By default only the accepted token contracts are queried, which works on public RPCs. With a paid RPC, `DEPOSITS_ALL_TOKENS=true` also records anything else as quarantined and warns the user once a day (INV-46).
- Next: per-line spend permissions on Base so a due bill can be charged from the user's dollars (RAILS "How an automatic payment works"), then the Paycrest off-ramp and an Arc treasury with CCTP (Base domain 6, Arc 26).

### D-061 Chain facts live in one file
`packages/chains/src/config.ts` holds every address, chain id, CCTP domain and confirmation depth, with where each was checked. Checked 2026-10-10: Arc chain 5042, USDC at 0x3600…0000 (6 decimals), CCTP domain 26; CCTP domains Base 6, Stellar 27; CCTP V2 TokenMessenger 0x28b5…cf5d and MessageTransmitter 0x81D4…4B64.

### D-062 Stellar: a public, tamper-evident record of every payment — *brings forward part of D-011 and D-051's Stellar role*
- Hourly, the worker puts every newly settled renewal into a Merkle tree and writes the root as the memo of a Stellar transaction from Constant's own account (a no-op operation; fee 0.00001 XLM paid by Constant).
- Each receipt page shows the payment and a "Public record" check that runs in the reader's browser: it recomputes the receipt's fingerprint, walks the proof to the root, and links to the transaction.
- A receipt commits to its random 128-bit id, amount, currency, provider, last 4 digits and time. No name, phone or full number. Customers never see the word Stellar (rule 10); the page says "public record".
- Batches are saved before they are sent, so an outage only delays the record. Tested live on Stellar testnet on 2026-10-10.
- The Soroban mandate (an on-chain cap per line) and Stellar USDC deposits via CCTP stay in Phase 3.

### D-063 Paying naira bills from USDC on Base, with spend permissions — *implements RAILS "How an automatic payment works"*
- **Account:** the user's Privy smart wallet, a Coinbase Smart Wallet on Base, with the embedded wallet as its signer. Stablecoins are deposited there.
- **Permission:** per bill, the user signs one EIP-712 SpendPermission for Coinbase's Spend Permission Manager (0xf852…67Ad, checked against `getHash` on Base mainnet 2026-10-10): USDC only, at most the bill's naira limit at today's Paycrest rate plus 8%, every 30 days, for a year. The app first adds the manager as an owner of the smart wallet (once, gas sponsored), and refuses any manager or token other than the pinned ones, whatever the server says.
- **Checks:** the API re-derives every field (account is the user's own smart wallet from Privy, spender, token, period, dates, allowance ≤ 125% of a fresh proposal) and verifies the signature (ERC-1271 / ERC-6492). The API knows only the spender's address; the worker alone holds its key.
- **When a bill is due:** `decideDollarRenewal` applies every naira rule, then: an approved permission, a rate under 10 minutes old, room in this period, money in the wallet. The worker re-checks on chain, signs the spend transaction, saves its hash and bytes, then sends it; after 5 confirmations it credits exactly the order's naira to the user's balance, and only then does the normal vend run (INV-15, INV-45). A failed vend leaves that naira in the user's balance.
- **Unclear:** a charge not mined is re-sent byte-for-byte after 10 minutes, never re-signed; after 60 minutes a person decides and the line is frozen. Nothing is vended meanwhile.
- **Stop:** effective immediately in Constant; the on-chain revoke is sent by Constant's spender (`revokeAsSpender`), so the user pays no gas. Cancelling a bill revokes too.
- **Next:** sweep the spender's USDC to the Arc treasury (CCTP) and off-ramp through Paycrest to refill the naira float; reconciliation of charges ↔ vends ↔ off-ramps. USDT later (spend permissions take any ERC-20).

### D-064 Guards on the dollar path — *from the external review, 2026-10-10*
Adopted. The review's point: the remaining risk isn't another network, it's a server key that can pull every permission, and a naira float that must exist before any USDC is taken.
- **Pinned spender:** the app only signs permissions whose spender equals `NEXT_PUBLIC_SPENDER_ADDRESS`, fixed at build time. A compromised API can't redirect users' permissions. (The manager and USDC addresses were already pinned.)
- **Limited blast radius:** charged USDC is swept from the hot spender to `TREASURY_ADDRESS` (required in production). All dollar charges together are capped per 24 hours (`DOLLAR_DAILY_LIMIT_USD`, default $500); passing it switches dollar charging off (`system_flags.dollar_charges_enabled`) and pages a person. Each user's own cap is still enforced on chain.
- **Float first:** no USDC is taken unless the VTpass balance covers the order plus a margin. Otherwise the charge waits and a person is paged (once an hour).
- **Screening:** the user's smart account and every address that sent it accepted tokens are screened with Circle's Compliance Engine before that money is used. A match freezes the user and pages a person; the user sees only a generic failure. An outage leaves money unused, never cleared. Required in production. Circle lists no Base or Arc network, so EVM addresses are screened as `ETH` (configurable).
- **Gas sponsorship:** the user's one transaction (adding the manager as an owner) is sponsored with a narrow paymaster policy (GO-LIVE). Constant's spender pays for approve and revoke itself.
- **Not adopted, as the review also said:** MoneyGram ramps, a Stellar wallet at sign-up, Agent Stack/x402, a third deposit network. Circle Gateway/CCTP stays for Constant's own treasury, later.

### D-065 An operator API, with an audit trail
Everything the system refuses to guess ends with a person: an order in `needs_human`, a frozen line or user, a tripped switch. `/ops` (bearer `OPS_TOKEN`, operator named in `x-ops-actor` on every write, a note on every action, all in `ops_actions`) lets them settle it without SQL. Alerts are emailed to `OPS_EMAIL` once. Unfreezing someone frozen by sanctions screening needs an explicit compliance confirmation. A second-operator approval is planned once there are two people (ARCHITECTURE "Security").

### D-066 Nightly reconciliation — *implements PLAN step 9*
`checkBooks` compares, for the last 35 days: every paid order has exactly its vend and fee entries and nothing else does; every confirmed dollar charge credited exactly its naira; every credited funding event exactly its amount. It asks VTpass about paid orders from the last 7 days and Base about recent charges. Runs at 02:00 Lagos and on request. Any mismatch switches off vending, dollar charges and payouts, and pages a person (INV-12).

### D-067 Naira withdrawals to the user's own account — *implements D-040; marketing still gated by D-050*
Built and switched off (`payouts_enabled`) until Paystack confirms in writing. Only to an account whose bank name contains the account holder's first and last names (the name on their Constant account number); a new or changed account waits 24 hours. The amount is held in the ledger the moment it's requested; `decideWithdrawal` never releases money held by open orders. Paystack transfers are idempotent by our reference, saved with the request; unclear outcomes are verified, never resent with a new reference; money comes back only on a definite failure or reversal.

### D-068 Refilling the naira float from charged USDC
When the VTpass balance drops below `FLOAT_LOW_NGN`, charged USDC on the spender is sold through Paycrest on Base straight into the VTpass funding account, up to `FLOAT_TARGET_NGN`. One off-ramp at a time; the order is saved by reference before Paycrest is called and the transfer by hash before it's sent; room is left for Paycrest's fees. The sweep to treasury waits while the float is low or an off-ramp is in flight. Paycrest webhooks (HMAC-SHA256) only finalize a funded order; the worker polls otherwise.
