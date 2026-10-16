# How ConstantUnits makes money

A proposal for the founder to decide on (2026-10-16). Today's prices are in `packages/rules/src/pricing.ts` (D-075);
nothing here changes them until a decision says so. All partner rates below are to be confirmed in the VTpass and
Paystack dashboards (PLAN B2) before anything is announced.

## What exists today

| Stream | Status | What we earn |
|---|---|---|
| VTpass commission on every vend | Built (D-031) | API rates on VTpass's own blog: MTN airtime and data 3%, DStv 1.5%, Ikeja Electric 1.5%, AEDC 1.2%. Other networks and DisCos differ. |
| ₦100 per electricity token | Built (D-020) | ₦100, only when the token is delivered |
| Card, USSD, QR top-ups | Built (D-075) | Nothing: Paystack's fee at cost |

Sources: [VTpass commission rates](https://vtpass.com/blog/?p=2993), [Paystack transaction pricing](https://support.paystack.com/hc/en-us/articles/360009881920), [Paystack dedicated virtual accounts](https://support.paystack.com/hc/en-us/articles/360009881760).

## One typical user, one month

A Lagos household on autopay: ₦10,000 data, ₦2,000 airtime, two ₦10,000 electricity tokens (Ikeja), DStv Compact
(about ₦19,000). Funded by one bank transfer of about ₦51,000.

| | Naira |
|---|---|
| Commission: data 3% + airtime 3% + electricity 1.5% + DStv 1.5% | 300 + 60 + 300 + 285 = **945** |
| Electricity fee, 2 tokens | **200** |
| **Revenue** | **≈ 1,145** |
| Paystack fee on the transfer in (1%, capped at ₦300) | −300 |
| Messages (about 8 SMS; WhatsApp and Telegram cost less) | −40 |
| **Contribution** | **≈ 800** |

That's about ₦0.8M a month per 1,000 active users, before staff, hosting and support. It works as a base, but it isn't
yet a business. Two facts matter:

- **The biggest cost is the money coming in.** Each bank transfer costs up to ₦300. Two transfers a month instead of
  one cost the user's whole data margin. Nudge people to one top-up on payday.
- **Paystack allows 1,000 dedicated accounts per business by default.** Ask for the increase early, or keep Monnify
  ready as the second rail (D-022).

## What to add, in order

1. **Fund once a month (now, no new revenue, saves the most).** A "payday" top-up: the app tells each user the one
   amount that covers all their bills for the month, with a reminder on payday. It cuts the transfer fee to ₦300 a month
   at most, and every bill renews on time.

2. **ConstantUnits Plus, about ₦1,500 a month (pilot in month 2 or 3).** For people who run more than one home or
   family member's line: several homes and family lines on one account, a spare electricity token kept ready (D-049),
   WhatsApp delivery, and priority support. Free stays fully useful for one person; Plus sells convenience, not
   access. Already on the roadmap (D-031, D-020's "revisit when an owner has more than 5 sites").

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

- Fees on data and airtime: a ₦100 fee on ₦1,000 of data is 10%, and people leave (D-031).
- A hidden FX spread, ads, or selling anyone's data. Trust is the product.
- Interest on the money in pots. That's regulated stored value; only through the licensed partner, with written
  approval, and never counted on in a plan.

## Numbers to watch from day one

Monthly active payers, bills renewed on time (%), revenue and contribution per user, top-ups per user per month (the
transfer fee), cost per message, and how many users hold more than one home (the Plus signal) or ask for business use.
