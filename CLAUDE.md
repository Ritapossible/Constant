# CLAUDE.md — project memory

Read this first. It is the short version of everything an engineer or coding agent must not get wrong. Longer reasoning lives in `docs/`.

## What Constant is

A power account for an owner who pays for prepaid electricity meters they are not standing next to: a shop, a family house, a staff room. The owner sets each meter once. Constant buys a fixed amount on the weekdays they chose, and texts the token to the phone at that place. It never spends past the cap. One word freezes it.

The person at the premises gets a normal 20-digit token by SMS and keys it in. They never make an account.

Company and SMS sender name: **Constant**. First market: Nigeria, IKEDC, naira. Built so Ghana, Kenya and South Africa are new adapters and copy, not a rewrite (`docs/EXPANSION.md`).

## Non-negotiables

1. **`packages/rules` is the only place that decides buy or do-not-buy.** A buy amount computed anywhere else (a webhook handler, a job, a template) is a bug.
2. **Every invariant in `docs/INVARIANTS.md` has a test.** Add or change a rule: write the failing test first.
3. **Money is `bigint` minor units** (kobo, pesewas, cents). No floats, no `number`, no string maths. Columns end in `_minor` and sit next to a `currency`.
4. **No LLM on the money path.** Not in parsing, routing, deciding or vending.
5. **The payee is fixed when the site is created.** Never pay a meter or account number read from an inbound message.
6. **Settlement comes only from a signed partner webhook or `fetch(partnerRef)`.** HTTP 200 on the vend call is not a token.
7. **Persist before you act.** `partnerRef` before treating a vend as accepted. The token before any SMS. The raw inbound payload before routing.
8. **Ambiguous means stop.** Unknown state, or ledger vs partner disagreement: `needs_human`, freeze that site (or kill vending globally on reconciliation mismatch), page a person. Never retry a vend to find out.
9. **Tokens and meter numbers are secrets.** Never in a URL, a log line, an error message, an analytics event, or the receipt page. Log meter last 4 and a token hash.
10. **Customers see local currency only.** Never: blockchain, crypto, wallet, seed, gas, USDC, XLM, Stellar, dollars. `scripts/guard.sh` enforces this on `packages/copy`.
11. **Silence means nothing.** No reply neither cancels a scheduled buy nor creates an early one. Constant does not know units left and must not guess.
12. **Do not add product surface** that is not in `PLAN.md`. No dashboard, no app, no card payments, no airtime, no second chain.

## Layout

```
apps/api            Fastify: WhatsApp, funding and vend webhooks; receipt page     (not started)
apps/worker         pg-boss: schedule scan, vend, notify, reconcile                 (not started)
packages/rules      Pure decisions and their tests                                  (DONE: step 1)
packages/db         Postgres 16 schema, migrations, ledger and order repositories   (not started)
packages/partners   Vending, Funding, Messaging interfaces; Fake + one real each    (not started)
packages/copy       Every customer-facing string, per locale                        (not started)
contracts/mandate   Soroban mandate. Not scheduled. See DECISIONS D-011.
docs/               ARCHITECTURE, INVARIANTS, DECISIONS, UX, EXPANSION, OPERATIONS
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

## Where we are

See `PLAN.md`. Step 1 (rules + invariant tests) is done. Next: step 2, schema, ledger, fake vend, double-submit tests against a real Postgres.
