# Money rails: naira, Base, Arc, Stellar

How money gets into Constant and out to DSTV, VTpass and the rest. Facts were checked against the official docs on 2026-10-06; sources are at the bottom. Re-check them before mainnet, because these products change monthly.

## The rule that doesn't change

Bills in Nigeria are paid in naira. USDC and USDT never pay IKEDC or DSTV directly. Every dollar path ends in an off-ramp to naira, then the vend partner. The chains are where a user's dollars wait and how Constant is allowed to take them, within limits the user signed.

## Built so far (2026-10-10)

| Network | Live in code | Next |
|---|---|---|
| **Base** | Each user's own address, from Privy, server-side. USDC/USDT deposits recorded after 12 confirmations, user told (D-060). Dollar autopay: per-bill spend permission on the user's smart wallet, charge confirmed before vend (D-063). | Paycrest off-ramp to refill the naira float; USDT permissions. |
| **Arc** | Same address; USDC deposits recorded (final in under a second). Chain facts verified (D-061). | Treasury on Arc; CCTP from Base (domain 6 → 26). |
| **Stellar** | Hourly Merkle root of settled receipts as a memo; public receipt page checks it in the browser. Tested on testnet (D-062). | Fund a public-network account; Soroban mandate and CCTP deposits in Phase 3. |

## Two ways to fund, one experience

| | **Naira** (most users in Nigeria) | **Dollars** (diaspora, crypto users) |
|---|---|---|
| How they add money | Bank transfer to their own account number (Paystack, Monnify fallback) | Send USDC or USDT **on Base** to their Constant address |
| Where it sits | Pots held by a licensed partner (custodial) | In the user's **own smart account** on Base (non-custodial) |
| How a pot is enforced | Constant's ledger (`packages/rules`) | An on-chain **spend permission per line**: token, amount and period the user signed |
| Withdraw | Payout to their bank account (D-040) | It's already theirs; "Withdraw" sends USDC/USDT to any address or off-ramps to their bank |
| Cancel | Ledger moves the pot back | Revoke the spend permission (gas sponsored) |
| What they see | ₦ balance, covered-until | ₦ estimate at today's rate, plus the dollar amount, covered-until |

The dollar path has a regulatory advantage: Constant never holds the user's balance, only a permission to take a capped amount when a bill is due.

## Accounts that feel like web2

1. **Sign in with phone number or email and a one-time code.** No seed phrase, no extension, no network picker, no passkey prompt required. Passkeys can be offered later as an option, not the front door, because many low-end Android phones handle them badly.
2. **Behind the scenes:** a CDP Embedded Wallet is created for that login, with an ERC-4337 smart account on Base. Gas is sponsored by a paymaster, so the user never needs ETH.
3. **Naira users never see any of this.** The wallet is only created when someone taps "Add dollars".
4. **Recovery** is the same phone number or email: the embedded wallet is tied to that login, not to a phrase.

Open check (PLAN B11): which CDP Embedded Wallets SDKs exist for mobile. If there is no native Android SDK, the wallet step runs in a React Native module or an in-app web view, while the sensors (usage stats, USSD) stay native Kotlin.

## How an automatic payment works (dollar path)

Each line (DSTV, Data, ChatGPT…) gets its own **spend permission** on the user's smart account:
- Spender: Constant's CDP server wallet.
- Token: USDC, or USDT on Base (spend permissions accept any ERC-20).
- Allowance per period: the bill's dollar equivalent plus an FX buffer the user sees (e.g. DSTV ₦15,700 ≈ $10.40 → "up to $11.50 every 30 days").
- The confirm screen says it plainly: "Constant can take up to $11.50 every 30 days for DSTV. Stop it any time."

When a bill is due:

```
1. decide (packages/rules): due, within cap, line active
2. quote: naira price → dollar amount at the current off-ramp rate
   if the dollar amount > remaining allowance → ask the user, do not charge
3. charge: useSpendPermission / subscription charge → USDC lands in Constant's Base wallet
   persist tx hash; settled only on chain confirmation
4. vend: pay the bill from Constant's prefunded naira float at VTpass   ← user isn't kept waiting
5. replenish: off-ramp the received USDC/USDT to naira via Paycrest on Base
6. reconcile: charge ↔ vend ↔ off-ramp, nightly
```

Charging before vending is the original invariant 15 ("spend must succeed before vend"), now on Base. Vending from a prefunded float instead of waiting for each off-ramp keeps renewals instant; the cost is a small FX exposure for minutes, which reconciliation measures.

**Base Subscriptions** (fixed USDC amount per period) suit flat bills like ChatGPT. **Raw spend permissions** suit naira bills, whose dollar amount moves with FX, and data, whose amount varies. Use the subscription helper where it fits, spend permissions elsewhere.

## What each network does

| Network | Role in Constant | Not used for |
|---|---|---|
| **Base** | User accounts (embedded wallet + smart account), USDC/USDT deposits, spend permissions, off-ramp via Paycrest (supports USDC and USDT on Base to NGN). | — |
| **Arc** (mainnet since 16 Sep 2026; USDC is the gas token) | Constant's USDC treasury and settlement; later StableFX if a naira-linked stablecoin or FX route appears. Users who already hold USDC on Arc can deposit to a Constant-managed Arc address, which is bridged to their Base account with CCTP. | USDT (no USDT on Arc), user accounts, the off-ramp (Paycrest does not list Arc). |
| **Stellar** (CCTP live since May 2026) | Phase 3: an optional on-chain cap and audit trail per line (the Soroban mandate from the original spec), and USDC deposits from Stellar wallets via CCTP. Fees and reserves sponsored by Constant, so the user never holds XLM. | Sign-up; the first release. |

Start with Base alone. Add Arc as treasury once there is volume to hold. Add Stellar when its role (an independent cap, or Stellar-native users) has a real user asking for it. Running three chains on day one triples security work, monitoring and reconciliation for no extra customer value.

## Deposits: avoid lost money

- One address per user, Base only, shown with "Base network only. USDC or USDT only. Anything else may be lost." in red, **before** they copy it.
- Exchange withdrawal tip: "In Binance, Bybit or Coinbase, choose network: Base."
- Watch for wrong-token deposits (other ERC-20s on Base) and return them by hand where possible; the policy is published.
- USDT on Base: accept only the contract address Paycrest lists for off-ramp (`0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2`, verify at deploy). Never a look-alike token.

## Words on screen

Dollar-funded users must see "USDC", "USDT", "Base" and an address in the **Add dollars** and **Withdraw** screens; that is what they are using. Everywhere else, and always in SMS, receipts for the person at the premises, and naira users' screens, the old rule holds: no chain, wallet or token words (D-053).

## Not used

- **Circle Agent Stack / x402.** For AI agents paying for APIs. Constant is a person approving a capped bill. No model on the money path (D-052).
- **A user-held seed phrase, an ETH or XLM balance, a network picker.**

## Regulatory checks before any dollar goes live (PLAN B12)

- A written legal opinion on accepting stablecoin deposits and off-ramping them for Nigerian users, under the Investments and Securities Act 2025 and SEC Nigeria's rules for digital-asset service providers, and on whether Constant needs registration or should operate only through licensed partners.
- Paycrest's (or the chosen off-ramp's) licensing and KYC responsibilities in writing.
- Embedded-wallet provider terms for the non-custodial model.

## Sources (checked 2026-10-06)

- Arc mainnet date and USDC gas: [arc.io blog](https://www.arc.io/blog/arc-mainnet-goes-live-on-september-16-2026), [Circle press release](https://www.circle.com/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet), [Arc docs](https://docs.arc.io/arc-chain). Stablecoins with published Arc contracts: USDC, EURC, USYC ([Coin Bureau](https://coinbureau.com/education/what-is-arc-circle-stablechain)).
- CCTP on Stellar: [Crossmint](https://www.crossmint.com/announcement/cctp-stellar), [Crowdfund Insider](https://www.crowdfundinsider.com/2026/05/282791-circles-cctp-goes-live-on-stellar-enabling-stablecoin-usdc-connectivity-across-blockchains/).
- Base Subscriptions (USDC only; `subscribe`, `charge`, `revoke`; paymaster): [CDP: Accept recurring payments](https://docs.cdp.coinbase.com/coinbase-wallet/guides/accept-recurring-payments), [Base subscribe reference](https://docs.base.org/sdks/base-account/reference/base-pay/subscribe).
- Spend permissions (any ERC-20, smart accounts, Base and other EVM chains, paymaster): [CDP spend permissions](https://docs.cdp.coinbase.com/server-wallets/v2/evm-features/spend-permissions).
- Embedded wallets with email/SMS OTP and smart accounts: [CDP embedded wallets](https://docs.cdp.coinbase.com/embedded-wallets/welcome), [authentication methods](https://docs.cdp.coinbase.com/embedded-wallets/authentication-methods).
- Paycrest networks and tokens (Base supported; USDT and USDC; Arc and Stellar not listed): [supported stablecoins](https://docs.paycrest.io/resources/supported-stablecoins.md), [quickstart](https://docs.paycrest.io/quickstart).
