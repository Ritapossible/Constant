# How ConstantUnits makes money

Today's prices are in `packages/rules/src/pricing.ts` (D-075). Adopted on 2026-10-17 (D-077, replacing D-076): one fee
per delivered bill, data ₦50, airtime ₦30, cable ₦100, electricity ₦100; the first delivered payment on an account free. All partner rates below are to be confirmed in the VTpass and
Paystack dashboards (PLAN B2) before anything is announced.

## What exists today

| Stream | Status | What we earn |
|---|---|---|
| VTpass commission on every vend | Built (D-031) | API rates on VTpass's own blog: MTN airtime and data 3%, DStv 1.5%, Ikeja Electric 1.5%, AEDC 1.2%. Other networks and DisCos differ. |
| One fee per delivered bill | Built (D-077) | Data ₦50, airtime ₦30, cable ₦100, electricity ₦100; first delivered payment free |
| Card, USSD, QR top-ups | Built (D-075) | Nothing: Paystack's fee at cost |

Sources: [VTpass commission rates](https://vtpass.com/blog/?p=2993), [Paystack transaction pricing](https://support.paystack.com/hc/en-us/articles/360009881920), [Paystack dedicated virtual accounts](https://support.paystack.com/hc/en-us/articles/360009881760).

## One typical user, one month

A Lagos household on autopay: ₦10,000 data, ₦2,000 airtime, two ₦10,000 electricity tokens (Ikeja), DStv Compact
(about ₦19,000). Funded by one bank transfer of about ₦51,000.

Cautious commission rates (replace with the VTpass agreement's before freezing anything): data and airtime 2%, cable
1%, electricity 0.8%.

| | Naira |
|---|---|
| Fees (D-077): data ₦50 + airtime ₦30 + two tokens ₦200 + DStv ₦100 | **380** |
| Commission: data 2% + airtime 2% + electricity 0.8% + DStv 1% | 200 + 40 + 160 + 190 = **590** |
| **Revenue** | **≈ 970** |
| Paystack fee on the transfer in (1%, capped at ₦300) | −300 |
| Messages (about 8 SMS; WhatsApp and Telegram cost less) | −40 |
| **Contribution** | **≈ 630** |

The first month is ₦100 lower (the first delivered payment is free). Grok's leaner household (₦40,000 sent once, DStv
₦15,700, ₦3,000 data, one ₦10,000 token) leaves about ₦240. The fee is there so a single DStv renewal never costs
ConstantUnits money; the company is the number of households, not a higher price.

That's about ₦0.63M a month per 1,000 active households (₦0.24M for lean ones), before staff, hosting and support. It works as a base, but it isn't
yet a business. Two facts matter:

- **The biggest cost is the money coming in.** Each bank transfer costs up to ₦300. Two transfers a month instead of
  one cost the user's whole data margin. Nudge people to one top-up on payday.
- **Paystack allows 1,000 dedicated accounts per business by default.** Ask for the increase early, or keep Monnify
  ready as the second rail (D-022).

## What to add, in order

1. **Fund once a month (now, no new revenue, saves the most).** A "payday" top-up: the app tells each user the one
   amount that covers all their bills for the month, with a reminder on payday. It cuts the transfer fee to ₦300 a month
   at most, and every bill renews on time.

2. **No monthly plan (D-077).** The per-bill fee is the whole price for people. Revisit only if households with
   several homes ask for one; a plan must never be needed to use ConstantUnits.

3. **ConstantUnits for business: about ₦300 to ₦500 per line per month (the bigger bet).** Employers paying staff
   data and airtime allowances, landlords and estates keeping rented flats' meters topped up, schools and churches
   with DStv and electricity. They already do this by hand every month. A dashboard, one invoice and caps per line.
   Same commissions on top. A 200-line company is worth more than 100 consumers.

4. **AI and streaming subscriptions on virtual cards (Phase 3, D-039).** A disclosed per-renewal fee and the FX
   margin the card issuer allows, shown next to the dollar price. Needs a licensed card issuer first.

5. **Family abroad paying in dollars: a decision for you.** Today the pricing page promises "no spread added" on
   stablecoins. A disclosed 1% dollar-payment fee (about ₦1,500 on $100) would be normal for diaspora remittance and
   would still be cheaper than a money-transfer service. If you want it, change `pricing.ts`; the page, /llms.txt and
   the charge all follow.

6. **The developer API (Phase 6, D-055).** Other apps paying bills through ConstantUnits's rules and receipts, per call.

## What not to do

- Large fees on small top-ups: a ₦100 fee on ₦1,000 of data is 10%, and people leave. That's why data is ₦50, airtime
  ₦30, and both autopay only from ₦500 (D-077).
- A hidden FX spread, ads, or selling anyone's data. Trust is the product.
- Interest on the money in pots. That's regulated stored value; only through the licensed partner, with written
  approval, and never counted on in a plan.

## Numbers to watch from day one

Monthly active payers, bills renewed on time (%), revenue and contribution per user, top-ups per user per month (the
transfer fee), cost per message, and how many users hold more than one home or ask for business use.
