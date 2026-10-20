# Blockchain grants: what each chain can honestly claim

Reviewers test the chain path, not the write-up: they open the app, send $5, and look at an explorer. One chain per
application, and only a chain with a transaction link to paste. (Review of 2026-10-20.)

| Chain | What the code does today | What an application may say | Proof to attach |
|---|---|---|---|
| **Base** | The user's own Coinbase smart account; USDC and USDT deposits indexed after 12 confirmations and screened; one spend permission per bill (Coinbase's Spend Permission Manager), charged only after it confirms, then the naira vend; charged USDC swept to the treasury; Paycrest off-ramp to refill the VTpass float. Gas sponsorship is specified (GO-LIVE.md), not yet proven. | "Diaspora USDC on Base pays a Nigerian bill, and ConstantUnits can take only the cap the user signed." Lead with the bill: email sign-in, no seed phrase, "up to $11.50 every 30 days for DStv." | The 8-step proof run in GO-LIVE.md, recorded: $5 USDC in, permission approved, charge on Basescan, sandbox vend, receipt checked against Stellar testnet, Stop revoking the permission. **Apply first, after this run.** |
| **Arc** | USDC deposits indexed. Autopay written (Spend Permission Manager on Arc, then CCTP to Base, where the off-ramp is). Off until `scripts/arc/proof-testnet.mjs` prints ALL PASSED. | Not yet. After the proof: "USDC never has to sit on Base first: the user keeps it on Arc, ConstantUnits takes a capped amount, and Circle's bridge settles it where the off-ramp lives." Say Paycrest doesn't list Arc, so the off-ramp stays on Base. | ALL PASSED log, then one $5 Arc charge bridged by CCTP and a bill paid. |
| **Stellar** | Once an hour, a Merkle root of settled receipts as a transaction memo; the receipt page verifies it in the browser. No user account, no Stellar USDC, no Soroban. | A feature inside the Base application: "every paid bill has a public fingerprint on Stellar." Not a Stellar grant on its own. | A receipt page showing "Checked in your browser" with the Stellar transaction link. |
| **QIE** | ConstantMandate contract, tested; testnet deploy waiting for faucet funds. The hackathon wants a **verified mainnet** contract and the official QIE stablecoin address, which is still unconfirmed. | A separate submission (deadline 30 November). Never described as the Base or Arc integration. | Verified mainnet contract + `scripts/qie/proof-testnet.mjs` output. |

## A Stellar grant later

Needs a real path first: a user sends USDC on Stellar, ConstantUnits fee-bumps it so they need no XLM, CCTP brings it to
Base, and the same spend permission pays the bill. Then: "a Stellar USDC balance can keep a decoder on," with the
receipt anchoring as the audit trail.

## Never in an application

- That a network is live because the website lists it.
- A video of naira screens without an explorer link.
- That the app reads a meter or a SIM: it doesn't yet (bills pay on a day, or when the user reports them low). The
  grant is for capped stablecoin payments of bills people already pay; the monthly renewal is what a 90-day traction
  clause can measure.
