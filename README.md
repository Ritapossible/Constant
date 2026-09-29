# Constant

Constant keeps the light on at meters you pay for but are not standing next to: a shop, a family house, a staff room.

You set each meter once: the amount, the days, a weekly cap. Constant buys a token on those mornings and texts it to the phone at that place. It never spends past the cap. Send STOP and it freezes.

The person at the premises gets a normal 20-digit token by SMS on any phone. No app, no account.

First market: Nigeria (IKEDC, naira). Designed to extend to Ghana, Kenya and South Africa.

## Read these

| File | What it is |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project memory: the rules every engineer and coding agent follows. |
| [`PLAN.md`](PLAN.md) | Build order, exit tests, business track, open questions. |
| [`docs/SPEC.md`](docs/SPEC.md) | The original product build spec. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Components, data model, money transactions, security. |
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md) | What must never break, and the test that guards each item. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why things are the way they are, including every change to the spec. |
| [`docs/UX.md`](docs/UX.md) | Message rules, accessibility, languages, adoption. |
| [`docs/GO_TO_MARKET.md`](docs/GO_TO_MARKET.md) | Pilot segment, price, channel and success measures. |
| [`docs/EXPANSION.md`](docs/EXPANSION.md) | How a new country is added. |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | On-call and support runbook. |

## Develop

```sh
nvm use            # Node 22
corepack enable    # pnpm 10
pnpm install
pnpm check         # typecheck + tests
```

## Status

Step 1 of `PLAN.md` is done: `packages/rules` and its invariant tests. Everything else is planned, not built.
