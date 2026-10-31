# ConstantUnits

**Set it once. Never run out.**

ConstantUnits pays Nigerians' everyday bills automatically: data, airtime, electricity, cable TV and subscriptions. People put money aside, set a limit per bill, and ConstantUnits pays each one on time, warns them before anything runs low, and never spends past the limits they chose. They can pause, cancel or withdraw at any time.

- **Website and app:** [constantunits.xyz](https://constantunits.xyz)
- **Stellar proof for reviewers:** [constantunits.xyz/proof](https://constantunits.xyz/proof): every testnet transaction, linked.
- **Status:** early access in Nigeria. Naira payments run through licensed partners; stablecoin autopay is built, with Stellar proven on testnet.

---

## Contents

- [What it does](#what-it-does)
- [Status](#status)
- [Architecture](#architecture)
- [Infrastructure](#infrastructure)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Testing and CI](#testing-and-ci)
- [Deployment](#deployment)
- [Security](#security)
- [Documentation](#documentation)
- [Team and licence](#team-and-licence)

## What it does

| Bill | How it's paid |
|---|---|
| **Cable TV** (DStv, GOtv, StarTimes) | Renewed before it expires, after checking the price against the person's limit. |
| **Data and airtime** (MTN, Airtel, Glo, T2) | Topped up on a schedule or when running low, within a weekly limit. |
| **Electricity** (prepaid and postpaid meters) | Bought on a schedule; the token is sent straight to the owner. |
| **Subscriptions** (ChatGPT, Claude, Spotify, Netflix…) | Tracked, with a reminder before each renewal. |

Around the bills:

- **Money in:** a personal account number for bank transfers (after identity verification), plus card, USSD and QR top-ups.
- **Pots:** money set aside per bill, so one bill can't spend another's money.
- **Reminders:** a warning when a bill can't be paid, then "due soon" and a "last call" before the service ends. Never at night.
- **Withdrawals:** to a bank account in the person's own verified name.
- **Stablecoins:** bills can be paid from USDC or USDT the person holds, under a spending limit they sign once per bill.
- **Receipts:** every payment gets a receipt, anchored hourly on the Stellar ledger.
- **Channels:** messages by email, SMS and Telegram; `STOP` and `START` by Telegram.

## Status

| Area | State |
|---|---|
| Web app, accounts, bills, pots, reminders | Live in early access |
| Naira top-ups (transfer, card, USSD, QR) | Built with Paystack |
| Bill payments | Built with VTpass |
| Identity tiers (BVN) and limits | Built (D-086) |
| Withdrawals | Built; switched off until launch (`payouts_enabled`) |
| USDC/USDT on Base autopay | Built; proof run pending |
| USDC on Stellar autopay | **Proven end to end on testnet** ([proof](https://constantunits.xyz/proof)); mainnet next |
| USDC on Arc autopay | Built; off until its testnet proof passes |
| Android app (on-device data sensing) | Not started |

## Architecture

```mermaid
flowchart LR
  U[Person<br/>browser or phone] --> WEB[apps/web<br/>Next.js on Vercel]
  WEB -->|HTTPS + Privy token| API[apps/api<br/>Fastify on Pxxl]
  API <--> DB[(Postgres<br/>Neon)]
  WK[apps/worker<br/>on Pxxl] <--> DB
  API --> R[[packages/rules<br/>pure logic]]
  WK --> R

  PS[Paystack] -->|signed webhooks| API
  VT[VTpass] -->|signed webhooks| API
  WK -->|pay bills| VT
  WK -->|transfers out| PS
  WK -->|email · SMS · Telegram| MSG[Resend · Termii · Telegram]
  WK <-->|mandates, charges, receipts| XLM[Stellar / Soroban]
  WK <-->|spend permissions| BASE[Base · Arc]
  WK -->|USDC → naira| PC[Paycrest]
```

- **Two processes, one database, one pure library.** The API answers the app and partner webhooks; the worker does everything scheduled (renewals, payments, notices, reconciliation). Every decision about money is a pure function in `packages/rules`, property-tested, and called by both.
- **Money is a ledger.** Balances are sums of append-only ledger entries with idempotency keys. Nothing is paid twice, however often a request or webhook is retried.
- **Partners hold the money.** ConstantUnits is not a bank: naira sits with Paystack, bills are paid through VTpass, and stablecoins stay in the person's own wallet until a charge they approved.

## Infrastructure

### Hosting and data

| Service | Used for |
|---|---|
| **Vercel** | The website and web app (`apps/web`), and DNS for `constantunits.xyz`. |
| **Pxxl** | The API and the worker, as two services built from this repo (`apps/*/pxxl.toml`). |
| **Neon** | Managed Postgres. Migrations in `packages/db/migrations`. |
| **GitHub Actions** | CI on every push: types, tests, builds, lint, contract tests, secret guard. |

### Accounts and identity

| Service | Used for |
|---|---|
| **Privy** | Sign-in with Google, email, phone (SMS), passkeys or a wallet. Embedded wallets on Base and Stellar, created with the sign-in (no seed phrase). The API verifies Privy tokens and keeps its own server-side sessions. |
| **Paystack Identity** | BVN verification against a bank account in the person's name (identity tier 1). |

### Naira payments

| Service | Used for |
|---|---|
| **Paystack** | Dedicated account numbers for transfers in; checkout for card, USSD and QR top-ups; bank list and account-name checks; transfers out for withdrawals. Signed webhooks. |
| **VTpass** | Bill payments: cable TV, data, airtime and electricity, with a requery on any unclear result. |

### Messages

| Service | Used for |
|---|---|
| **Resend** | Email: receipts, reminders, security notices. |
| **Termii** | SMS, including electricity tokens. |
| **Telegram Bot API** | Messages and `STOP` / `START` commands, linked from the app. |

### Stablecoins and chains

| Network or service | Used for |
|---|---|
| **Stellar (Soroban)** | Our own mandate contract (`contracts/mandate`, Rust): one capped approval per bill, charged within the cap, revocable at once. Sponsored accounts, so people never hold XLM. Circle USDC. Also the hourly Merkle root of receipts. Testnet. |
| **Base** | USDC and USDT deposits to the person's own smart account; Coinbase's Spend Permission Manager for capped recurring charges. |
| **Arc** | USDC autopay through the same permissions, bridged to Base with Circle's CCTP. Off until proven. |
| **Circle** | USDC on every network, CCTP bridging, and address screening. |
| **Paycrest** | Turns charged USDC into naira to keep the bill-payment float topped up. |
| **QIE** | A separate hackathon contract (`contracts/qie`, Foundry). |

## Repository layout

```
apps/
  web/        Next.js 16 website and app (React 19): landing, app screens, legal pages, /proof
  api/        Fastify 5 API: accounts, bills, money, webhooks, ops endpoints
  worker/     Scheduled work: renewals, payments, chains, notices, withdrawals, reconciliation
  android/    Planned Kotlin app (not started)
packages/
  rules/      Pure business logic (renewals, limits, KYC, pricing, reminders), property-tested
  db/         Postgres access, migrations, encryption of references
  partners/   Clients for Paystack, VTpass, Privy, Paycrest, Resend, Termii, Telegram, Circle (and fakes for tests)
  chains/     Base, Arc and Stellar: readers, spend permissions, the Stellar rail, decode-before-sign checks
  copy/       Every message a person receives, in one place, each one SMS long
contracts/
  mandate/    Soroban mandate contract (Rust) and its tests
  qie/        Solidity contract for QIE (Foundry)
scripts/      Testnet proof runs, deploy scripts, database backup, secret guard
docs/         Product, architecture, decisions, invariants, operations, proofs
brand/        Brand assets and video sources
```

## Getting started

**Requirements:** Node 22 (`.nvmrc`), pnpm 10 (via Corepack), Postgres 16 for tests. Rust with `stellar-cli` for the Soroban contract, and Foundry for `contracts/qie`.

```sh
nvm use                 # Node 22
corepack enable         # pnpm 10
pnpm install
pnpm check              # typecheck + all tests
pnpm --filter @constant/web lint
```

The db, API and worker tests each create a throwaway database. Point them at a local Postgres first:

```sh
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres
```

Run the app locally:

```sh
pnpm --filter @constant/web dev        # http://localhost:3000
```

Without `NEXT_PUBLIC_API_URL` the app runs as an on-device preview. Every environment variable, with what it does and where it's set, is in [`docs/ENV.md`](docs/ENV.md). Secrets never go in the repo.

## Testing and CI

| Suite | What it covers |
|---|---|
| `packages/rules` | Property tests (fast-check) for every money rule: renewals, limits, pots, KYC, pricing, reminders. |
| `packages/db` | Ledger and database invariants against real Postgres. |
| `apps/api` | Every route and webhook, against real Postgres with fake partners. |
| `apps/worker` | Renewals, payments, crashes and retries, chains, notices, withdrawals. |
| `packages/chains`, `packages/partners`, `packages/copy`, `apps/web` | Chain logic, partner clients, message rules, app logic. |
| `contracts/mandate` | Soroban contract tests (`cargo test`). |
| `contracts/qie` | Foundry tests. |

CI (`.github/workflows/ci.yml`) runs typecheck, all tests, every build, the web lint, both contract suites, and `scripts/guard.sh`, which fails on secrets or banned words in user-facing text. What must never break, and the test guarding each item, is in [`docs/INVARIANTS.md`](docs/INVARIANTS.md).

Testnet proof runs, recorded in [`docs/proof`](docs/proof):

```sh
node scripts/stellar/proof-testnet.mjs   # the contract's rules on Stellar testnet
node scripts/stellar/e2e-testnet.mjs     # the API and worker, from linking to a paid bill and a revoke
```

## Deployment

| Part | Where | How |
|---|---|---|
| Web | Vercel | Deploys `main` automatically. Public settings are `NEXT_PUBLIC_*`. |
| API | Pxxl | Base directory `apps/api`; see [`docs/PXXL.md`](docs/PXXL.md). |
| Worker | Pxxl | Base directory `apps/worker`; answers `GET /health`. |
| Database | Neon | Migrations in `packages/db/migrations`. Backups: `scripts/backup-db.sh`. |
| Stellar contract | Testnet | `node scripts/stellar/deploy.mjs`. |

Going live, step by step: [`docs/GO-LIVE.md`](docs/GO-LIVE.md).

## Security

- **No secrets in the repo.** Keys live only in Vercel and Pxxl settings; `scripts/guard.sh` checks every push. The Privy app secret never reaches the website.
- **Verified webhooks only** from Paystack, VTpass, Paycrest and Telegram (signature or shared secret); raw bodies are kept for audit.
- **Idempotency everywhere:** ledger entries, orders and partner references are keyed, and the API accepts `Idempotency-Key` on every request that moves money.
- **Limits enforced on the server:** per-bill caps, weekly caps, identity tiers with daily limits, a 3-day hold on card money before withdrawal, and withdrawals only to the verified name.
- **Decode before sign:** the app checks the exact bytes of every Stellar signature against what the screen says, with the contract pinned in the build.
- **Kill switches** for payments, withdrawals and dollar charges, and nightly reconciliation against partners.
- **Private data:** bill references are encrypted at rest; only the last 4 digits of a BVN are kept.

## Documentation

| File | What it is |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | The rules every engineer and coding agent follows. |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | What ConstantUnits is, product by product. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Components, data model, money flows. |
| [`docs/RAILS.md`](docs/RAILS.md) | How money moves: naira, and stablecoins on Base, Arc and Stellar. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every decision and why, numbered (D-001 onwards). |
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md) | What must never break, and the test that guards it. |
| [`docs/ENV.md`](docs/ENV.md) | Every environment variable. |
| [`docs/PXXL.md`](docs/PXXL.md) | Deploying the API and worker. |
| [`docs/GO-LIVE.md`](docs/GO-LIVE.md) | The launch checklist. |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | On-call and support runbook. |
| [`docs/LEGAL.md`](docs/LEGAL.md) | Legal pages and compliance notes. |
| [`docs/GRANTS.md`](docs/GRANTS.md) | Grant and ecosystem applications, and what each can claim. |
| [`docs/proof`](docs/proof) | Recorded testnet proof runs. |
| [`docs/UX.md`](docs/UX.md), [`docs/DELIVERY.md`](docs/DELIVERY.md), [`docs/SENSING.md`](docs/SENSING.md) | Messages and accessibility, delivery channels, measuring what's left. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md), [`PLAN.md`](PLAN.md) | Phases and next build steps. |
| [`docs/GO_TO_MARKET.md`](docs/GO_TO_MARKET.md), [`docs/REVENUE.md`](docs/REVENUE.md), [`docs/EXPANSION.md`](docs/EXPANSION.md) | Market, revenue model, new countries. |

## Team and licence

| | |
|---|---|
| Founder | [@Ritapossible](https://github.com/Ritapossible) |
| Contact | constantunitshq@gmail.com |

© 2026 ConstantUnits. All rights reserved. This code is proprietary; no licence is granted to use, copy or distribute it.
