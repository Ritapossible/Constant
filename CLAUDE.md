# CLAUDE.md — project memory

Read this first. It is the short version of everything an engineer or coding agent must not get wrong. Longer reasoning lives in `docs/`.

## What Constant is

**Set it once, never think about it again** (D-028, D-040). Users put money aside in pots inside Constant; Constant pays their recurring essentials automatically and warns them before anything runs low. They can cancel, pause, reschedule or withdraw at any time. Nigeria runs on prepaid, and data, airtime and electricity all run out without warning. Constant watches what it can measure, refills inside limits the owner sets, and says what it spent. Product: `docs/PRODUCT.md`. How we know what's left: `docs/SENSING.md`. Phases: `docs/ROADMAP.md`.

- **Data and airtime:** the Android app is the sensor (data-usage counter plus USSD balance); the network credits the bundle directly. Fully automatic.
- **Electricity:** we know the units we sold, learn the home's usage rate from meter readings, ask for a reading only when it matters, buy on a reading at the line, and can keep one spare token ahead. A person still keys the token in until smart-meter partnerships exist.
- **Cable TV:** DSTV, GOtv, StarTimes renew before expiry (D-041, Phase 1).
- **Subscriptions:** AI tools and others renew monthly on merchant-locked cards (D-039).
- **Running-low reminders:** probability of running out in 48h, and wallet runway (D-042, D-043; `packages/rules/src/forecast.ts`).
- **Later:** family and remote lines, Constant Eye hardware, DisCo and network partnerships.

Company and sender name: **Constant**. First market: Nigeria, naira. Data nationwide; electricity DisCo by DisCo (D-038). Built so Ghana, Kenya and South Africa are new adapters and copy (`docs/EXPANSION.md`).

## Non-negotiables

1. **`packages/rules` is the only place that decides buy or do-not-buy.** A buy amount computed anywhere else (a webhook handler, a job, a template) is a bug.
2. **Every invariant in `docs/INVARIANTS.md` has a test.** Add or change a rule: write the failing test first.
3. **Money is `bigint` minor units** (kobo, pesewas, cents). No floats, no `number`, no string maths. Columns end in `_minor` and sit next to a `currency`.
4. **No LLM on the money path.** Not in parsing, routing, deciding or vending.
5. **The payee is fixed when the line is created.** Never pay a meter, phone or account number read from an inbound message.
6. **Settlement comes only from a signed partner webhook or `fetch(partnerRef)`.** HTTP 200 on the vend call is not a token.
7. **Persist before you act.** `partnerRef` before treating a vend as accepted. The token before any SMS. The raw inbound payload before routing.
8. **Ambiguous means stop.** Unknown state, or ledger vs partner disagreement: `needs_human`, freeze that site (or kill vending globally on reconciliation mismatch), page a person. Never retry a vend to find out.
9. **Tokens and meter numbers are secrets.** Never in a URL, a log line, an error message, an analytics event, or the receipt page. Log meter last 4 and a token hash.
10. **Customers see local currency only.** Never: blockchain, crypto, wallet, seed, gas, USDC, XLM, Stellar, dollars. `scripts/guard.sh` enforces this on `packages/copy`. One exception: subscription screens show the merchant's dollar price next to the naira charged and the rate (D-039); that copy lives in its own allow-listed file when `packages/copy` is built.
11. **Silence never buys, and estimates are labelled.** Only a trusted reading at the owner's line triggers a buy (D-032). Data is never bought on a forecast. Electricity buys early on a forecast only if the owner opted in. A forecast never raises a cap or an amount.
12. **Do not add product surface** that is not in `PLAN.md`. No web dashboard, no card funding, no chain, no hardware or subscriptions before their ROADMAP gate. Never hard-code a DisCo: utilities are rows with an enable flag (D-038).
13. **Privacy on the phone.** The app reads total mobile bytes and USSD balance replies only. Never SMS, contacts, location or per-app usage. Meter photos are read on the phone; only the number leaves it.
14. **Money in pots is the user's.** A pot pays only its own line; moving between pots needs permission each time; withdrawals are allowed any time except money committed to an open order (D-040).

## Layout

```
apps/api            Fastify: WhatsApp, funding and vend webhooks; receipt page     (not started)
apps/worker         pg-boss: threshold + schedule scans, vend, notify, reconcile    (not started)
apps/android        Kotlin app: data/airtime sensor, wallet, light readings        (not started)
packages/rules      Pure decisions and their tests                                  (DONE: step 1)
packages/db         Postgres 16 schema, migrations, ledger and order repositories   (not started)
packages/partners   Vending, Funding, Messaging interfaces; Fake + one real each    (not started)
packages/copy       Every customer-facing string, per locale                        (not started)
contracts/mandate   Soroban mandate. Not scheduled. See DECISIONS D-011.
docs/               PRODUCT, IDEAS, SENSING, ROADMAP, SPEC (v1), ARCHITECTURE, INVARIANTS, DECISIONS,
                    UX, EXPANSION, OPERATIONS, GO_TO_MARKET
```

## Commands

```
pnpm install
pnpm check          # typecheck + all tests
pnpm test           # tests only
pnpm build
./scripts/guard.sh  # banned words in copy, obvious secrets
```

Node 22 (`.nvmrc`), pnpm 10.

## Conventions

- TypeScript strict, ESM, `NodeNext` imports with `.js` suffix.
- Pure functions take `now: Date` as input. Nothing in `packages/rules` reads the clock, the network, env or the database.
- Test files are named after the invariants they guard (`*.invariants.test.ts`); each `describe` starts with `INV-n`.
- Property tests (fast-check) for anything that compares money.
- Times are stored as `timestamptz` UTC; weekday and "today" are always computed in the site's market time zone (`packages/rules/src/time.ts`).
- Idempotency keys come from `packages/rules/src/keys.ts` and sit in unique columns.
- Every decision that deviates from the original spec goes in `docs/DECISIONS.md` with a reason.

## Decided

Android app is required (D-029, supersedes "no app"). First users: urban Android users with a data plan and a prepaid meter (D-030). DisCos are data rows, each enabled after its own gate; wave 1 is IKEDC, EKEDC, EEDC, AEDC (D-038). AI and other subscriptions renew monthly on merchant-locked cards, Phase 3 if a card issuer is signed (D-039). Data and airtime at face value, ₦100 per electricity token (D-031). VTpass for vending (D-024), Paystack virtual accounts for funding (D-022), Termii for SMS (D-025), managed PaaS in Frankfurt (D-026).

## Where we are

See `PLAN.md`. Step 1 (electricity rules + invariant tests) is done. Step 2 is under way (forecasts, reminders, wallet runway, withdrawal rules done; 149 tests). Next: the rest of step 2 (lines, readings, thresholds, pots), and step 5, the Android sensor spike, in parallel.
