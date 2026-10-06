# Constant

Constant keeps your prepaid life from running out.

Data finishes in the middle of a call. The meter at home finishes at night. Nobody knew it was low. Constant watches what it can measure, refills before you run out, stays inside the limits you set, and tells you what it spent.

- **Data and airtime:** the Android app measures what your phone has used and checks the network balance. At your line it buys your bundle, which lands on the SIM in seconds.
- **Electricity:** Constant knows what it sold, learns how fast your home uses power, asks for a meter photo only when it matters, buys when the reading hits your line, and can keep a spare token ready.
- **Later:** family lines, TV, a small meter sensor (Constant Eye), AI and other subscriptions in naira, and direct links with DisCos and networks.

First market: Nigeria (Lagos). Designed to extend to Ghana, Kenya and South Africa.

## Read these

| File | What it is |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project memory: the rules every engineer and coding agent follows. |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | What Constant is, product by product. |
| [`docs/SENSING.md`](docs/SENSING.md) | Every way to know what's left, how good it is, and when we can use it. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phases 0–5 with gates, including hardware and partnerships. |
| [`PLAN.md`](PLAN.md) | Next build steps, exit tests, business track. |
| [`docs/SPEC.md`](docs/SPEC.md) | The original v1 electricity spec (scope superseded; safety rules still apply). |
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

Step 1 of `PLAN.md` is done: `packages/rules` and its invariant tests for electricity. Next: rules for lines and thresholds, and the Android data-sensor spike.
