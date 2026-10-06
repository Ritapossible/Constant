# Ideas that make Constant a better business

Each idea says what it is, why it helps, how hard it is, its main risk, and when it fits. Ideas move into `PLAN.md` only when their phase comes and their evidence exists.

Effort: S (days) · M (weeks) · L (months) · XL (partnership or licence)

## A. Make "never think about it" true

| # | Idea | Why it matters | Effort | Risk | Phase |
|---|---|---|---|---|---|
| A1 | **Covered-until home screen.** One screen: "Data till Fri · Light till about Tue · DSTV till 15 Dec · ChatGPT till 3 Jan". | The whole product in one glance; the reason to open the app. | S | None | 1 |
| A2 | **Running-low probability reminders** (built: `forecast.ts`). | The founder's original pain: knowing *before* it runs out. | S (rules done) | Noise: capped at 1/day/line, quiet hours. | 1 |
| A3 | **Wallet runway** (built: `walletRunway`). "Your 15 Dec DSTV is ₦2,300 short." | Stops "I ran out of money" failures days ahead. | S (rules done) | None | 1 |
| A4 | **Payday plan.** User sets payday; Constant reminds them to fund each pot that day, with the exact total ("₦38,400 covers everything until next payday"). | Matches how Nigerians budget; turns funding into a once-a-month habit. | S | None | 1 |
| A5 | **Auto-fund from bank (direct debit).** With the user's mandate, Constant pulls the payday amount from their bank automatically. | Removes the last manual step. | L | Mandate set-up friction; partner availability; failed debits. | 3 |
| A6 | **Android home-screen widget** and a persistent "data left" indicator. | See data and light at a glance without opening anything. | S | Battery; keep updates sparse. | 1 |
| A7 | **"Before a long call" check.** One tap: "Enough data for a 45-minute video call?" Yes, or top up first. | Directly fixes the dropped-call story. | S | None | 1 |
| A8 | **Pot borrowing with permission.** If DSTV is short but the Data pot has spare, ask once: "Move ₦2,300 from Data to DSTV?" | Fewer failures without new money. | S | Must never happen silently. | 2 |

## B. Save people money (the strongest retention lever)

| # | Idea | Why it matters | Effort | Risk | Phase |
|---|---|---|---|---|---|
| B1 | **Best-plan advisor.** From real usage: "You use 9 GB a month. Plan X costs ₦1,200 less for the same data." | Constant pays for itself; people tell friends about savings. | M | Plan catalogues change; keep them as data and re-verify. | 2 |
| B2 | **Price-change watch.** Data, DSTV and tariff changes are common. "DSTV Compact goes up on 1 Dec. Your next renewal will be ₦X." | Trust; no surprises. | S | Source reliability. | 1 |
| B3 | **Electricity band awareness.** Show the tariff band for the meter and the cost per unit trend from each token. | Explains why light suddenly costs more. | S | Band data accuracy. | 2 |
| B4 | **Monthly statement.** "October: ₦41,200 on essentials. Light ₦18,000, data ₦9,500, DSTV ₦13,700." | Budgeting; a reason to keep money in Constant. | S | None | 1 |

## C. Trust (the hardest thing to earn, the easiest to lose)

| # | Idea | Why it matters | Effort | Risk | Phase |
|---|---|---|---|---|---|
| C1 | **Show where the money is held:** the licensed partner's name in every funding screen. | Answers "is my money safe?" before it's asked. | S | None | 1 |
| C2 | **Constant guarantee.** If a renewal fails because of Constant (not because a pot was short), Constant pays any reconnection fee or the cost of the outage day. Capped and published. | Turns the promise into something people can rely on. | M | Cost; cap it, measure it. | 2 |
| C3 | **Instant withdrawal.** Withdrawals in minutes, not days, with no fee for the first one each month. | People deposit more when they know they can get it out. | M | Partner payout speed; fraud checks. | 1 |
| C4 | **Every payment has a receipt** with the provider's reference, and a support answer within an hour during the day. | Payment apps are judged on their worst day. | S | Staffing. | 1 |

## D. Grow the number of lines per user

| # | Idea | Why it matters | Effort | Risk | Phase |
|---|---|---|---|---|---|
| D1 | **Family plan.** One payer, many lines: Mum's data, the family house meter, siblings' DSTV. | Each user brings 2–4 lines; diaspora families pay for home. | M | Consent of the other person; who gets the receipts. | 3 |
| D2 | **Gift a pot.** "Send Mum a Light pot of ₦20,000"; she gets the tokens as she needs them. | Better than sending cash; fits gifting culture. | S | None | 3 |
| D3 | **Employer staff data / light benefit.** Companies fund a monthly pot per staff member. | B2B revenue, bulk sign-ups, low acquisition cost. | M | Sales cycle; invoicing. | 4 |
| D4 | **Landlords and estates.** Meters for many units, a pot per tenant or per flat. | Many meters per customer. | M | Tenant disputes; keep the landlord as owner. | 4 |

## E. Reach people who don't fit the app

| # | Idea | Why it matters | Effort | Risk | Phase |
|---|---|---|---|---|---|
| E1 | **WhatsApp-only mode** for iPhone users and older relatives: BALANCE, LOW, STOP, PAUSE, reminders and receipts. | Everyone has WhatsApp. | M (much built) | Meta template costs. | 1 |
| E2 | **USSD channel** for feature phones: check pots, top up, pause. | Reaches people with no smartphone. | L | Aggregator cost; session limits. | 4 |
| E3 | **Pidgin, Igbo, Yoruba, Hausa** in the app and messages. | Reach and warmth. | M | Native-speaker review. | 2–3 |

## F. Revenue beyond partner discounts

| # | Idea | Why it matters | Effort | Risk | Phase |
|---|---|---|---|---|---|
| F1 | **Constant Plus** (monthly): family lines, spare-token float, priority support, the guarantee (C2), early access to subscriptions. | Predictable revenue on top of thin per-payment margins. | M | Must be clearly worth it. | 3 |
| F2 | **Small fee on subscriptions** (card issuing and FX cost plus margin), shown up front. | Subscriptions carry real costs; customers expect a fee. | S | Compare with alternatives; stay transparent. | 3 |
| F3 | **Essentials advance.** When a pot is empty, pay now and repay on payday, using months of on-time history to decide who qualifies. | Large need; Constant has unusually good data on regular bills. | XL | Needs a lending licence or a licensed partner; strict consumer-credit rules. | 5 |
| F4 | **Interest on money set aside,** through a licensed partner. | A reason to keep larger balances in Constant. | XL | Regulation; never promise returns ourselves. | 5 |
| F5 | **Embedded Constant for banks and fintechs** (API). Banks offer "auto-renew my bills" powered by Constant. | Distribution through someone else's millions of users. | L | Partner dependency. | 5 |

## G. Defensibility (why a big app can't just copy this)

1. **The sensor on the phone and in the home.** Data measurement, meter readings, and later Constant Eye give data the networks and VTU apps don't have.
2. **Money already set aside.** Bank apps can pay a bill; they don't hold a pot per bill with caps and a covered-until date.
3. **Many bills, one promise.** Cable, data, light and subscriptions in one place, with one "you're covered" answer.
4. **Usage history** that improves forecasts, the plan advisor, and later the essentials advance.
5. **Partnerships** (DisCos, meter makers, networks) that take years, started early (PLAN B8).

## What to measure

- **Lines per user** (target: 3 by month 3).
- **Money set aside per user** and **days covered** across all pots.
- **Failures prevented:** renewals that would have failed without a reminder or autopilot.
- **Ran-out rate:** share of lines that ran out while on Constant (target: under 1%).
- **Withdrawal rate:** high withdrawal shortly after deposit is a trust warning sign.
- **Reminder usefulness:** reminders followed by an action or a top-up, vs ignored.
