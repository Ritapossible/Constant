# Constant

**Set it once. Never think about it again.**

Put money aside in Constant for the things you pay for again and again. Constant pays them automatically, warns you before anything runs low, and lets you cancel, pause or withdraw your money at any time.

Data finishes in the middle of a call. The meter at home finishes at night. Nobody knew it was low. Constant watches what it can measure, refills before you run out, stays inside the limits you set, and tells you what it spent.

- **Data and airtime:** the Android app measures what your phone has used and checks the network balance. At your line it buys your bundle, which lands on the SIM in seconds.
- **Electricity:** Constant knows what it sold, learns how fast your home uses power, asks for a meter photo only when it matters, buys when the reading hits your line, and can keep a spare token ready.
- **Cable TV:** DSTV, GOtv and StarTimes renew before they expire.
- **Subscriptions:** AI tools like ChatGPT and Claude renew every month in naira.
- **Running-low reminders:** "70% chance your data runs out before tomorrow evening", and "your DSTV renewal is ₦2,300 short", days before it fails.
- **Later:** family lines, a small meter sensor (Constant Eye), and direct links with DisCos and networks.

First market: Nigeria. Data and airtime nationwide; electricity opens DisCo by DisCo, starting with IKEDC, EKEDC, EEDC and AEDC. Designed to extend to Ghana, Kenya and South Africa.

## Read these

| File | What it is |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project memory: the rules every engineer and coding agent follows. |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | What Constant is, product by product. |
| [`docs/IDEAS.md`](docs/IDEAS.md) | Ideas to make the business stronger, scored by effort, risk and phase. |
| [`docs/RAILS.md`](docs/RAILS.md) | How money moves: naira, and USDC/USDT on Base, Arc and Stellar, with sources. |
| [`docs/REVIEW-2026-10-06.md`](docs/REVIEW-2026-10-06.md) | What we took from external advice, and why. |
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
