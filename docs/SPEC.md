# Constant — build spec

> The original product spec, kept as written. Where the build deliberately differs, `docs/DECISIONS.md` says so and why.

Hand this entire document to the engineer or coding agent. Do not add product surface that is not listed here.

## What this is

Constant is the power account for an owner who pays for meters they are not standing next to. Shops, family houses, and staff rooms. They set each meter once. Constant buys a fixed naira amount on the days they chose, and sends the token to the phone at that place. It will not spend past the cap. They can freeze it with one word.

The person at the premises gets a normal 20-digit token by SMS and keys it into the meter. They never create an account, see a wallet, or hear the words crypto, Stellar, USDC, or XLM.

Company and SMS sender name: Constant.

Naira is the only money the user sees. No dollar price, no FX toggle, no USDC amount on WhatsApp, SMS, or the receipt page.

This is not a meter monitor. Constant does not know the units left. The loop is the owner's calendar plus a cap, not a sensor.

## What still needs a person

A normal IKEDC prepaid meter does not accept a token remotely. Constant can repeat the purchase forever. Someone at the premises must punch in the 20 digits when the SMS arrives. If that phone is wrong, the buy still succeeds and the light still goes out. The site phone is required.

Constant also cannot see the units. Do not poll a meter API. Do not infer "they must be low" from silence or from last week's weather.

## What v1 is not

Do not build any of this in v1:

- Reading the meter automatically.
- Buying because nobody replied. Silence does not mean the meter is low. Silence also does not cancel a scheduled buy.
- Data, airtime, or DSTV. Electricity only.
- Card payments. v1 funding is a bank transfer into a dedicated virtual account.
- OCR of meter photos.
- A mobile app, a wallet connect button, or a chain picker.
- Arc, Base, x402, CCTP, Paycrest, 0G, or any second chain. Leave an Attestor interface. Do not implement it.
- Parsing a meter number or account number out of an inbound message and paying that. The payee is fixed when the site is created.
- Holding customer naira in a founder's personal account. The float sits with a licensed partner. This software records a liability and calls the partner.
- A stateless design. Postgres is the support record.
- A subscription billing system, a dashboard for 50 staff, or diaspora payouts. One owner may have up to 5 sites. That is enough.
- An LLM on the money path.
- Guessing a smarter interval from history. The owner picks the days. Constant does not retune them.

## Actors

- Owner. Creates sites, sets the days and the amount, funds each site, skips, freezes. Identified by phone number.
- Site phone. The phone at the premises. Receives the token SMS. May send LOW or SKIP. Cannot change the meter, the amount, the days, or the owner phone.
- Constant. The scheduler and the rule check. Then the vend partner.
- Vend partner. One licensed API that turns naira into an IKEDC token. Behind an interface. Dev uses a fake.
- Funding partner. One virtual-account provider, behind an interface.
- Chain. Soroban mandate on Stellar. Caps and freeze. Added after fake money works. Not what support staff read first.

The owner and the site phone may be the same number. Roles stay separate in the data.

## Two modes

- schedule. The company path. Buys on the owner's days. No unit reading required.
- alert. Free option. Never buys. When the site phone sends a number at or below a threshold, the owner is told. Nothing else happens.

A site is one or the other. Do not vend because someone replies BUY to an alert. That reply starts schedule onboarding. It does not vend.

## Invariants

These are bugs if they ever fail. Write tests before the WhatsApp adapter.

1. A scheduled buy runs only when next_run_at is due, the site is schedule mode, verified, active, funded, inside the weekly cap, and outside the minimum gap since the last successful buy.
2. Silence does not cancel a scheduled buy.
3. Silence does not create an early buy.
4. A frozen site does not buy.
5. Amount above the remaining balance or the weekly cap does not buy.
6. Two runs inside the minimum gap do not buy twice. The scheduler and a LOW text share that gap.
7. A duplicate webhook or a retried job does not vend twice.
8. A partner timeout does not vend twice. If the partner reference was not saved, stop and alert a human.
9. SKIP cancels only the next run. It does not freeze the site.
10. The site phone cannot change meter number, DisCo, amount, days, or owner phone.
11. The token is stored before the SMS is sent. If SMS fails, resend the stored token. Do not buy again.
12. If the ledger and the partner disagree, vending stops for everyone until a human clears it.
13. A vend is settled only from the partner webhook or from fetch(partnerRef). HTTP 200 on the vend call is not settlement.
14. The full token never appears in a URL, a log line, or the public receipt.
15. Once the Soroban mandate is wired, spend must succeed before vend. Until then, do not pretend the chain is in the path.
16. An alert site never creates an order, never writes a vend entry, and never calls the partner.
17. No unit reading means no alert. Units above the alert threshold do not notify the owner.
18. LOW on an alert site does not buy.
19. A scheduled buy does not wait for a unit reading.

## The loop

Owner sets, once per site:

- IKEDC meter, validated with the partner lookup. Unverified meters do not vend.
- Site phone.
- Buy amount in naira. Example: 15000. Fixed.
- Days. One or more of Mon Tue Wed Thu Fri Sat Sun, at a Lagos time they choose. Default 07:00 Africa/Lagos. No "every 4 days" in v1. Weekdays only, so the next run is obvious.
- Weekly spend cap. Default is buy amount times the number of chosen days.
- Minimum hours between buys. Default 20.

While the site is active and the balance covers the amount, the worker buys on those mornings and sends the token. After each settled buy it sets next_run_at to the next chosen morning. It does not buy early to "catch up" missed days. If the worker was down on Monday, Monday is skipped, and the next chosen morning is the next run.

If the balance is short, do not vend. Tell the owner once: "Thursday's ₦15,000 for meter ending 6781 did not run. ₦4,000 left." Do not retry that morning in a loop. Next chance is the next chosen day, or a LOW after they fund.

## Exceptions, not the engine

- Site phone or owner sends LOW. If the minimum gap has passed and the balance covers it, buy the same amount now and move next_run_at to the next chosen morning after today. If the gap has not passed: "Last buy was too recent. Nothing bought."
- Owner sends SKIP. The next run is cancelled once. Reply with the new date. SKIP does not refund a token already sent.
- Owner sends STOP. Freeze every site of theirs, or STOP last-4 to freeze one meter. START reverses it.
- Owner sends BALANCE. One line per site: meter last 4, naira left, next run date. No dollars.

Do not parse a unit count on a schedule site. "18" on a schedule site gets: "This meter buys on its days. Send LOW to buy now, or SKIP to cancel the next one."

## Alert-only mode

Owner sets meter, site phone, and a threshold. No amount and no virtual account required.

- Site phone sends 18 and threshold is 20: tell the owner "18 units on meter ending 6781. You asked to be told at 20. Nothing was bought." Ack the site phone.
- Above the threshold: ack the site phone only.
- Not a number: "Send the units as a number, for example 18."
- One owner alert per site per 6 hours.
- Optional daily prompt is off by default. If on, ask the site phone once a day for a number. No reply means no alert. Do not call the meter low.

## What the user sees

WhatsApp plus SMS, and one public receipt page.

Scheduled success, to the site phone, SMS and WhatsApp:

- "Token ready. ₦15,000. Key in: 1234 5678 9012 3456 7890. Meter ending 6781. Receipt: https://constant.ng/r/Ab3kQ9"

Same fact to the owner, without requiring them to load it:

- "Paid ₦15,000 for meter ending 6781. Next is Thursday. ₦35,000 left."

LOW too soon:

- "Last buy was too recent. Nothing bought."

Funding:

- "Transfer ₦50,000 to Constant account 0123456789, Wema Bank. Use reference C-1842. This meter will not buy until it arrives."

Receipt page, no login:

- Meter last 4, amount in naira, status, token last 4 only after the token is stored.
- No full token, no full meter, no phone number, no wallet address.
- Unguessable id. Rate-limit the page.

Friday note, only if something happened:

- "This week Constant paid ₦30,000 across 2 meters. ₦80,000 left."

Never say blockchain, gas, wallet, seed, USDC, or XLM.

## Architecture

A scheduler in the worker is the primary trigger. WhatsApp is how the owner sets the loop and how either phone sends LOW, SKIP, or STOP. The webhook does not decide the amount.

WhatsApp Cloud API goes to the API (HMAC check).
SMS and vending are called by the worker.
Funding webhook hits the API.
Postgres holds sites, the ledger, and orders.
packages/rules is the only place that returns buy or do-not-buy.
pg-boss runs the schedule and the vend jobs.
The Soroban mandate is added after fake money works.

Repo layout:

- apps/api — webhooks and the receipt page
- apps/worker — schedule scan, vend, sms, reconcile
- packages/rules — pure functions and tests
- packages/db
- packages/partners — Vending and Funding, fake plus one real adapter each
- contracts/mandate — later

Stack:

- TypeScript, Node 22, Postgres 16, integer kobo, never floats.
- Hono or Fastify. Pick one.
- pg-boss.
- WhatsApp Cloud API. Persist raw payloads.
- SMS behind an interface. Termii or Africa's Talking.
- One IKEDC vend adapter. One virtual-account adapter.
- Soroban on Stellar testnet only after the acceptance tests pass.

Do not store money in a spreadsheet, a JSON file, or browser storage.

## Data model

Money is bigint kobo.

owners: id, phone_e164 unique, created_at

sites: id, owner_id, site_phone_e164, mode schedule or alert, disco IKEDC, meter_ciphertext, meter_hash, verified boolean, buy_amount_kobo nullable (required for schedule), weekdays int array (1-7, required for schedule), run_minute_lagos int default 420, alert_threshold_units nullable, weekly_cap_kobo nullable, min_hours_between_buys int default 20, status active or frozen, next_run_at nullable, last_buy_at nullable, last_unit_price_kobo nullable, stellar_mandate_id nullable, virtual_account_number, virtual_account_bank

ledger_entries append only: id, site_id, kind fund / vend / refund / adjust, amount_kobo signed, idempotency_key unique, external_ref nullable, created_at

Balance is the sum. A cached balance is allowed only if the same transaction writes the entry.

orders: id, site_id, trigger schedule or low, state ready / vending / token_stored / notifying / settled / failed / needs_human, amount_kobo, idempotency_key unique, partner_ref nullable, token_ciphertext nullable, token_received_at nullable, evidence_sha256, error nullable, receipt_id unique, scheduled_for nullable

skips: id, site_id, skipped_run_at unique per site

inbound_messages: provider_id unique, from_phone, body, received_at

funding_events: provider_event_id unique, site_id, amount_kobo, status pending / credited / reversed

alerts: id, site_id, created_at

There is no readings-driven order on a schedule site.

## Order state machine

The schedule scan, every minute:

- Select schedule sites where status is active, verified is true, next_run_at <= now, and that next_run_at is not in skips.
- Call decideSchedule. If buy, insert an order with trigger schedule and state ready, idempotency key site_id plus scheduled_for. Then enqueue vend.
- If the reason is insufficient funds, notify the owner once for that scheduled_for and move next_run_at forward. Do not leave it due, or the scan will notify every minute.

LOW uses the same decide function with trigger low and scheduled_for null. Idempotency key is site_id plus the inbound provider message id.

Vend path:

- Persist partner_ref before treating the call as done.
- If the process dies after the HTTP call and the ref was not saved, freeze that site and alert a human. Do not call vend again.
- Settled only from a signed webhook or fetch returning a token.
- Store the encrypted token, write the receipt, send SMS, then mark settled.
- Write the negative ledger entry when the partner has accepted the vend, not when SMS succeeds.
- Then set last_buy_at and next_run_at.

Unknown partner errors are pending, not failed. Ambiguous means needs_human and freeze that site only.

When the mandate exists, spend is re-read and must succeed before vend. SMS failure does not unwind a successful spend.

## Rule engine

Pure functions.

decideSchedule inputs: mode, verified, frozen, balanceKobo, buyAmountKobo, weeklySpentKobo, weeklyCapKobo, lastBuyAt, minHours, now, vendingEnabled.

Returns buy with amountKobo, or do_not_buy with reason: not_schedule, unverified, frozen, insufficient, weekly_cap, too_soon, killed.

decideAlert inputs: mode, rawText, threshold, lastAlertAt, now.

Returns alert, or ignore with reason not_a_number, not_low, too_soon, not_alert.

Parser for alert mode only: trim, accept "18", "18 units", "18.5". Reject two numbers or an 11–13 digit string. Floor to whole units.

Quote check: if a side-effect-free quote says naira-per-unit is more than double the last successful buy for this meter, do not auto-buy. Notify the owner and skip that run. Never guess a price. If you cannot quote without vending, skip the price check.

## WhatsApp

Thin client. Authenticate, store the raw message, map the phone to owner or site phone, call packages/rules or a command. A buy amount that is computed only inside the webhook file is a bug.

Verify X-Hub-Signature-256.

Routing:

- Owner commands: STOP, START, SKIP, LOW, BALANCE, and the onboarding answers.
- Site phone commands: LOW, SKIP. A number only if that site is alert mode.
- Anyone else: "Constant buys light for meters an owner already added."

Onboarding for a schedule site, one question at a time:

1. Meter number.
2. Owner replies YES to the name the partner returns. Otherwise the site stays unverified and will not vend.
3. Site phone.
4. Amount, shown back as "I will buy ₦15,000."
5. Days, shown back as "Mondays and Thursdays, 7:00am."
6. Virtual account.

Outside the 24-hour window, only templates: funding received, token ready, skipped for lack of funds, price exception, weekly summary, vend failed.

Commands are exact words, case-insensitive.

## Partner interface

Vending:

- lookupMeter
- quote, only if it cannot itself buy
- vend, returns token, pending, or failed, and partnerRef when accepted
- fetch(partnerRef)

FakeVending returns a deterministic 20-digit token from the order id.

Funding:

- createAccount(siteId)
- parseWebhook(rawBody, signature)

Each site has its own virtual account. Do not pool five meters into one balance. One shop must not be able to spend another's money.

Credit a funding event only when the signature checks, the event id is new, the amount is positive, and the account maps to one site. Reversal debits and freezes that site if the balance would go negative.

## Soroban mandate

After fake money works. Do not block the scheduler on it.

Per site: owner address (server-sponsored, no user seed), meter hash, disco, remaining, max_single, frozen, attestor, last evidence hash. No phone numbers and no raw meter numbers on chain.

spend only from the attestor, only if not frozen, amount within max and remaining. The worker re-reads remaining before vend.

The user never holds XLM. The server sponsors the fee. Testnet until a week of reconciliation is clean. No mainnet in the first build.

## Reconciliation

Nightly, plus a manual run:

- Ledger sum equals cached balance per site.
- Settled orders match partner refs for that day.
- Once on chain, remaining plus settled spends equals what was funded.
- Any mismatch sets vending_enabled false.

## Security

- METER_ENCRYPTION_KEY and TOKEN_ENCRYPTION_KEY are separate. Never VITE_ or NEXT_PUBLIC_.
- Log meter last 4 and a hash of the token. Never the full token.
- Signatures on WhatsApp, funding, and vend webhooks.
- Rate-limit LOW, alerts, and the receipt page.
- NDPC: phone, meter, transaction history. Short privacy page. No contact upload.
- No secrets in the repo.

## Build order

1. packages/rules tests for the schedule and alert invariants. No HTTP.
2. Schema, ledger, fake vend, double-submit tests.
3. Schedule scan and vend worker, including both crash cases and SMS resend. Receipt hides the full token.
4. WhatsApp for a seeded schedule site: it buys when the clock says so, LOW buys early, SKIP skips once.
5. Onboarding and fake funding. Five sites on one owner, separate balances.
6. Alert mode. Prove it never vends.
7. Real IKEDC sandbox, one meter.
8. Reconciliation and the kill switch.
9. Soroban testnet, spend re-read before vend.
10. One owner with two real meters, and a human watching.

## Acceptance

- Seed a schedule site, weekdays Monday, ₦15,000, balance ₦50,000, min gap 20 hours.
- Do not send any WhatsApp. When next_run_at is due, one token is stored and the balance is ₦35,000.
- Run the scan again immediately. No second vend.
- Send nothing for a day. The next Monday still buys. Silence did not cancel it.
- LOW inside the gap does not buy. LOW after the gap buys once and moves the next run forward.
- SKIP then the due scan does not buy, and the run after that does.
- STOP then a due scan does not buy.
- Short balance does not vend and does not notify in a loop.
- Alert site, send 10. Owner is notified. No order, no ledger vend.
- Crash after partner_ref is saved. Still one vend. Crash before it is saved. No second vend. Site is needs_human.
- Pending does not settle and does not refund.
- Receipt URL has no 20-digit token.
- No user-facing string contains USDC, XLM, wallet, or a dollar amount.

## Company, not a feature

v1 is the loop above for a few meters. The thing a customer pays for later is the account: many sites, a cap per site, a freeze, and a receipt when they were not in the room. Do not build pricing, invoices, or a web dashboard in this pass. Do not add a second DisCo until the first adapter has settled real sandbox tokens for a week.

Arc, if it ever exists here, only replaces the attestor key. It is not part of this build.
