# QIE Hackathon 3.0 (Mainnet Edition)

Constant enters with a new way to fund a bill: QIE's stablecoin, held in a capped on-chain mandate written for this event (D-072, ARCHITECTURE "QIE"). Paystack, VTpass, and the Base, Arc and Stellar paths stay as they are. Source: [hackathon.qie.digital](https://hackathon.qie.digital/), read 2026-10-16.

## What the form requires

Submit by **30 November 2026** (demo week 1–5 Dec, winners 10 Dec). Sign in and give:

| Field | Value |
|---|---|
| GitHub repo | `Ritapossible/constant` |
| Live demo URL | `https://constant-units.vercel.app` (QIE screen live) |
| Contract | The **mainnet** `ConstantMandate` address, source verified on [mainnet.qie.digital](https://mainnet.qie.digital/) |
| Track | **Commerce & Real World** |

The testnet box on the hackathon page is a trap: submissions are **mainnet only**. A testnet address, or a site that still only charges on Base, does not qualify.

**Prizes:** $5k / $3k / $2k overall, $500 per track, Most Traction $2.5k, Community Choice $1k. Half is paid on 10 December. The other half needs **three traction proofs within 90 days**: more wallets, more transactions, repeat users, a merchant payment, monthly use, or revenue. Bills that renew every month are built for exactly this.

**Judging:** originality, real-world usefulness, product quality and UX, QIE ecosystem integration (bonus for using several of QIE Wallet, the stablecoin, QIEDEX, QIE Pass, oracles), adoption potential.

## Disqualification risks, and what we do about each

| Rule | Our position | Action |
|---|---|---|
| Copied contract, clone, "copied from Ethereum hackathons" | `ConstantMandate.sol` is written for this event. No Coinbase spend-permission code, no public escrow pasted in. OpenZeppelin 5 libraries (SafeERC20, ReentrancyGuard, Ownable2Step, Pausable) are building blocks, not a copied product. | Write it from the spec below; tests written alongside. |
| Forked or recycled existing project | Constant's first commit is 2026-09-29, inside the build window (1 Aug – 30 Nov), and it never entered another hackathon. | **Ask the organizers in writing** that a project started during the window qualifies. |
| "AI-generated projects with minimal developer contribution" | Much of the code was written with an AI assistant. The founder owns the product, partners and operations. | **Ask the organizers** (their FAQ asks "Can AI-assisted development be used?" without showing the answer). The founder must be able to explain and demo every part: contract, worker flow, money rules. Rehearse before demo week. |
| Demo that does not run | | Backend hosted (GO-LIVE) and the QIE path live on mainnet with real wallets before 30 Nov. |

## Chain

| | |
|---|---|
| Chain id | `1990` (hex `0x7C6`). Read it with `eth_chainId` before deploying; checked live 2026-10-16. Never `1983` (testnet) or the legacy `5656` / `9731`. |
| RPC | `https://rpc1mainnet.qie.digital/` (rpc1–rpc5 for failover) |
| Explorer | `https://mainnet.qie.digital/` (Blockscout v7: verify with the Blockscout verifier) |
| Gas token | QIE (18 decimals) |
| Solidity | `0.8.24`, Foundry (already used for the fork tests), OpenZeppelin 5 |
| Wallet | QIE Wallet browser extension: an EIP-1193 injected provider, found with EIP-6963 ([guide](https://docs.qie.digital/qie-wallet-integration-guide-for-websites.md)). Any injected EVM wallet works too. |

### The stablecoin: no address is invented

QUSDC has no address in QIE's docs, and the explorer shows several look-alikes (searched 2026-10-16):

| Symbol | Name | Address | Note |
|---|---|---|---|
| QUSDC | QUSDC | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` | source verified; **candidate** |
| QUSD | Qie Stable USD | `0x3533913F65244F61a2091Ee2D5d341DA83513d0C` | unverified; **candidate** |
| QUSDC | QIE USDC (Mock) | `0x88aBC76f…ec2D`, `0xc2e433C1…CB30` | mocks: never |
| qQUSDC | QIELend QUSDC | `0x3EcD3b3f…E542` | lending receipt: never |

The official contract comes from the QIE team (Telegram, or the token QIEDEX actually trades) and is saved in `contracts/qie/addresses.json` with the source and the transaction that proved it (a real QIEDEX swap or a QIE announcement). **The deploy script refuses to run until that file exists**, and refuses a token whose `decimals()`, `symbol()` or code differ from what the file records. Also ask: is it fully USD-backed, who issues it, and how does it redeem to USD?

### Oracles

Feeds exist for BTC, ETH, XRP, SOL, QIE, BNB and XAUt ([table](https://docs.qie.digital/qie-oracle/deployed-contracts/table-of-assets-contract-mapping.md)). **There is no NGN feed.** The QIE/USD feed (`0x3Bc617cF3A4Bb77003e4c556B87b13D556903D17`) may only *display* a quote (for example, what a user's QIE is worth in dollars). It never sets a charge. The naira vend amount still comes from VTpass, and the dollar charge from `usdcForNaira` with Paycrest's USDC/NGN rate, treating the stablecoin as $1 only once its peg is confirmed (open question 2).

## What we add (and what stays)

Nothing is replaced: Paystack, VTpass and the Base spend-permission path stay. QIE is one more way to fund a bill. Details in ARCHITECTURE "QIE: a capped mandate on chain 1990".

1. **`contracts/qie/src/ConstantMandate.sol`** (written 2026-10-16, tested; see `contracts/qie/README.md`): deposit, open a line with its cap, charge (spender only, within the cap, once per order), withdraw any time, revoke any time; pause stops charges, never withdrawals; no owner path to a user's money. Events `Deposited`, `LineOpened`, `Charged`, `Withdrawn`, `Revoked`.
2. **Tests (Foundry)** that must fail the build if: the spender charges over the cap; a second caller charges; a revoked line charges; the same order is charged twice; the owner can move a user's balance; pause blocks a withdrawal. Plus fuzz and invariant tests (the contract always holds at least the sum of user balances).
3. **`contracts/qie/script/Deploy.s.sol`**: runs only on chains 1983, 1990 and local; on mainnet refuses unless `addresses.json` has the official stablecoin and the live contract's code, symbol and decimals match it; reads token, treasury and owner back after deploying. Then the source is verified on the explorer and the addresses copied into `addresses.json`. `scripts/qie/proof-testnet.mjs` runs every rule on chain (15 checks).
4. **`packages/chains`**: a QIE client (chain id, RPC, stablecoin, mandate): read lines and balances, prepare and broadcast `charge`, read receipts.
5. **Worker**: charges only after `packages/rules` has approved the bill, persists the transaction hash before sending, vends only after the charge is confirmed, and never retries into a second charge (the contract also refuses a repeated order id).
6. **`apps/web`**: one screen, "Add dollars on QIE": adds chain 1990 to the wallet, shows the stablecoin amount, the cap and the mandate address, deposits and opens the line. The person at the meter still sees no chain words; SMS stays as it is.
7. **Metrics** for the 90-day claim (below).

## What happens when a vend fails

Grok's brief says "the stablecoin stays in the treasury and the order is marked for a human". Constant already has a rule for this on every dollar path (D-063): a confirmed charge credits exactly the order's naira to the user's Constant balance, and only then is the bill paid. If the vend fails, that naira stays in the user's balance, visible and refundable (withdrawal or the next renewal), and the order shows "Not paid". An unclear vend goes to `needs_human` as today. **There is never a second charge for the same order.** The stablecoin is in the treasury either way; what the user sees is their naira, not a stuck token.

## Open questions (ask QIE before writing the deploy script)

1. The official stablecoin contract on chain 1990 (QUSDC or QUSD?), with proof.
2. Is it 1:1 USD-backed, who issues it, and how does it redeem? Is there liquidity on QIEDEX?
3. **How does it become naira?** Paycrest doesn't list QIE. Options: QIEDEX → a bridge to Base USDC → Paycrest; an OTC desk; QIE's own ramp. Until one exists, Constant pre-funds the VTpass float in naira from its own funds and the stablecoin accumulates in the treasury, so QIE charges stay small (a separate daily limit, e.g. $100).
4. Is AI-assisted development allowed, and does a project started inside the build window qualify?
5. Is the explorer's verifier the Blockscout API at `mainnet.qie.digital/api`?

### Message to send (Telegram or info@qie.digital)

> Hello QIE team. We're entering QIE Hackathon 3.0 (Commerce & Real World) with Constant, which pays Nigerian prepaid bills (data, airtime, electricity, TV) automatically. We're adding a QIE mainnet contract so users can fund their bills with QIE's stablecoin. A few questions before we deploy:
> 1. What is the official stablecoin contract on chain 1990? The explorer shows several (QUSDC `0x3F43…5DA5`, QUSD "Qie Stable USD" `0x3533…0d0C`, and mocks).
> 2. Is it 1:1 USD-backed, who issues it, and how is it redeemed? Is it on QIEDEX with liquidity?
> 3. Is there a route from it to naira or USD (a ramp, OTC desk or bridge)?
> 4. Is AI-assisted development allowed if the team can explain and demo every part?
> 5. Our project started on 29 Sep 2026, inside the build window. Is that eligible?
> 6. Should contracts be verified through the Blockscout API at mainnet.qie.digital?
> Thank you.

## Metrics for the 90-day claim

Counted from chain events and Postgres, never from estimates; a small `/ops/hackathon` report (D-065 auth):

| Metric | Source |
|---|---|
| Distinct depositors | `Deposited` events, distinct `user` |
| Lines opened | `LineOpened` events |
| Charge count | `Charged` events (and `charges` rows with `chain = 'qie'`) |
| Repeat chargers | users with charges in 2+ distinct months |
| VTpass vends paid from QIE | settled orders whose charge is on QIE |
| Naira settled | sum of those orders' amounts |
| Monthly active users | users with a deposit or charge in the month |

## Done when

- A second wallet, not ours, deposits the stablecoin on **mainnet** through the app.
- A due bill calls `charge` for no more than its cap, and the explorer shows that debit and the `Charged` event.
- VTpass returns the token, or the order is visibly refundable in the app.
- The mandate's source is verified on mainnet.qie.digital, and its address is in `contracts/qie/addresses.json` and on the form.

## Order of work (six weeks)

1. **Now:** send the open questions to QIE; host the backend (GO-LIVE) so the demo runs.
2. **Week 1–2:** `ConstantMandate.sol` + tests; a review pass (security review of the contract and the worker path).
3. **Week 3:** `packages/chains` QIE client, worker charge path, migration, metrics.
4. **Week 4:** "Add dollars on QIE" screen; end-to-end on QIE testnet (chain 1983) with real testnet tokens.
5. **Week 5:** mainnet deploy with low caps; first outside users; verify on the explorer.
6. **Week 6:** demo rehearsal (the founder walks through the contract and the money flow), submission by 30 Nov.
