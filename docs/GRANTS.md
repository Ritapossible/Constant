# Blockchain grants: what each chain can honestly claim

Reviewers test the chain path, not the write-up: they open the app, send $5, and look at an explorer. One chain per
application, and only a chain with a transaction link to paste. (Review of 2026-10-20.)

| Chain | What the code does today | What an application may say | Proof to attach |
|---|---|---|---|
| **Base** | The user's own Coinbase smart account; USDC and USDT deposits indexed after 12 confirmations and screened; one spend permission per bill (Coinbase's Spend Permission Manager), charged only after it confirms, then the naira vend; charged USDC swept to the treasury; Paycrest off-ramp to refill the VTpass float. Gas sponsorship is specified (GO-LIVE.md), not yet proven. | "Diaspora USDC on Base pays a Nigerian bill, and ConstantUnits can take only the cap the user signed." Lead with the bill: email sign-in, no seed phrase, "up to $11.50 every 30 days for DStv." | The 8-step proof run in GO-LIVE.md, recorded: $5 USDC in, permission approved, charge on Basescan, sandbox vend, receipt checked against Stellar testnet, Stop revoking the permission. **Apply first, after this run.** |
| **Arc** | USDC deposits indexed. Autopay written (Spend Permission Manager on Arc, then CCTP to Base, where the off-ramp is). Off until `scripts/arc/proof-testnet.mjs` prints ALL PASSED. | Not yet. After the proof: "USDC never has to sit on Base first: the user keeps it on Arc, ConstantUnits takes a capped amount, and Circle's bridge settles it where the off-ramp lives." Say Paycrest doesn't list Arc, so the off-ramp stays on Base. | ALL PASSED log, then one $5 Arc charge bridged by CCTP and a bill paid. |
| **Stellar** | Bills paid from USDC on Stellar through Constant's own Soroban mandate contract (D-085): the user links a Stellar account by signature, Constant sponsors the account and USDC trustline (the user never holds XLM), the user signs one capped mandate per bill, the worker charges within the cap straight to the treasury, then the naira vend. Plus the hourly receipt root as a memo. Testnet only; mainnet waits for Stellar screening and funded keys. | "Diaspora and Nigerian USDC on Stellar keeps a decoder on: one signature, a cap the contract enforces, no XLM, no seed phrase from us." Say it is on testnet, that the off-ramp of Stellar USDC (CCTP to Base or a Stellar anchor) is the next build, and that the app's screens are built (a Stellar wallet with the user's sign-in, D-089). | `docs/proof/stellar-e2e.md` (the real API and worker, linking to revoke, every step a testnet link) and `docs/proof/stellar-testnet.md` (the contract's rules: cap, duplicate charge, revoke). The contract on stellar.expert. |
| **QIE** | ConstantMandate contract, tested; testnet deploy waiting for faucet funds. The hackathon wants a **verified mainnet** contract and the official QIE stablecoin address, which is still unconfirmed. | A separate submission (deadline 30 November). Never described as the Base or Arc integration. | Verified mainnet contract + `scripts/qie/proof-testnet.mjs` output. |

## A Stellar grant (Stellar Community Fund)

**Track: Integration** (decided 2026-10-31). The Stellar wallet is a Privy embedded wallet and the USDC-to-naira path
uses Circle's CCTP; both are on SCF's Integration List. Integration awards are panel-reviewed and pay the last 40%
against an on-chain metric: ten households renewing monthly from Stellar. Stage: testnet, in preview; never claim live
payments. The application is the proof page (constantunits.xyz/proof), the contract on stellar.expert and the public
repo. Ask only for the cost of: mainnet contract with a screened treasury and a $5 charge of our own; one real bill
(that USDC to naira via CCTP and Paycrest, paying our own DStv renewal); then ten households. One chain per form:
no Base, Arc or QIE here.

Ready for a testnet-stage application. What a reviewer can check without trusting us:

1. The contract (`contracts/mandate`) and its 14 tests; the deployed code on stellar.expert.
2. `node scripts/stellar/proof-testnet.mjs`: a user with no XLM, Circle testnet USDC, one signature, two charges into
   the treasury, and the contract refusing a repeated charge id, a charge over the cap and a charge after revoke.
3. `node scripts/stellar/e2e-testnet.mjs`: the same through ConstantUnits' API and worker, ending in a renewed bill.

What the grant would fund, in order (the app's Stellar screens are built, D-089: a Privy Stellar wallet with the sign-in, sponsored onboarding, approve a bill, every signature decoded and checked first): Stellar
sanctions screening; mainnet keys and an RPC provider; turning treasury USDC into naira (CCTP to Base, where the
Paycrest off-ramp is, or a Stellar anchor); then electricity and data bills on the same mandate. A 90-day traction
clause can count monthly renewals paid from Stellar.

## Never in an application

- That a network is live because the website lists it.
- A video of naira screens without an explorer link.
- That the app reads a meter or a SIM: it doesn't yet (bills pay on a day, or when the user reports them low). The
  grant is for capped stablecoin payments of bills people already pay; the monthly renewal is what a 90-day traction
  clause can measure.
