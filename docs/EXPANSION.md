# Expanding beyond Nigeria

The loop (owner sets days and amount → Constant buys → token goes to the site phone) is the same anywhere prepaid meters use keyed tokens. What changes per country is partners, rails, regulation, language and copy. None of that should touch `packages/rules`.

## What is market-specific, and where it lives

| Concern | Lives in | Nigeria (live first) |
|---|---|---|
| Currency, minor unit, zone, locale | `markets` row | NGN, kobo, Africa/Lagos, en-NG |
| Utilities and meter validation | `packages/partners` vending adapter | IKEDC first, then other DisCos |
| How owners fund | `packages/partners` funding adapter (`FundingDisplay`) | Dedicated virtual bank account per site |
| SMS route and sender ID | messaging adapter + registration | "Constant", registered per network |
| Copy and languages | `packages/copy/<locale>` | English, then Pidgin |
| Regulation | legal checklist below | CBN (partner licence), NDPA/NDPC |

The rule engine already takes the time zone as input and compares integer minor units, so a new market is new data plus new adapters.

## Candidate markets

These notes are starting points for discovery and have to be confirmed with local partners before anything is built.

**Ghana.** Cedi (GHS). Africa/Accra. Mobile money is the everyday way to pay, so funding is likely a MoMo collection per site rather than a bank account. The prepaid meter base is mixed, and some meter types are topped up differently from STS keyed tokens. Before committing, confirm which meter types can receive a token the site phone keys in.

**Kenya.** Shilling (KES). Africa/Nairobi. Prepaid STS tokens are widespread and people already buy them over M-Pesa. Funding is naturally M-Pesa (paybill and account number, or STK push). Constant's edge here is the schedule, the cap and delivery to someone else's phone, not the payment itself. Buying a token is already easy there, so validate demand before building.

**South Africa.** Rand (ZAR). Africa/Johannesburg. STS prepaid is common, supplied by Eskom and by municipalities, which means many vending relationships. Funding options include EFT and instant payment rails. The market is mature and competitive for buying a token, and less so for "pay for someone else's meter on a schedule, capped". Landlords and employers are the natural wedge.

## Readiness checklist per market

A market is enabled only when every line is true:

1. A licensed funding partner holds customer money; its licence covers prefunded balances used for scheduled bill payment. Written confirmation on file.
2. One vend adapter has settled real sandbox (or pilot) tokens for a week with clean reconciliation.
3. Multi-token vends (key change tokens) tested against that utility.
4. SMS sender ID approved on the major networks; delivery measured on basic phones.
5. WhatsApp templates approved in the market's languages.
6. Data protection registration and privacy page in place; hosting and cross-border transfer reviewed.
7. Copy reviewed by native speakers; every SMS fits one segment in that locale.
8. Customer support hours cover the market's mornings (default buy time is 07:00 local).
9. Unit economics positive per vend after partner fees, SMS and messaging costs.

## Order of expansion

Depth before breadth. First more DisCos in Nigeria, because every Nigerian owner with a family house outside Lagos needs a second utility. Then one new country, picked by pilot evidence (waitlist, partner terms), not by population.
