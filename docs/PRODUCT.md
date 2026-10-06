# Constant — product

> Supersedes the scope of `docs/SPEC.md` (the original electricity-only, calendar-only v1). The money-safety rules from that spec still hold everywhere.

## The problem

Nigeria runs on prepaid and on renewals. Data, airtime, electricity, cable TV and online subscriptions all have to be bought again and again, and each one fails in its own way:

- The data finishes in the middle of a WhatsApp call. You only find out when the call drops.
- The meter at home finishes at night. Nobody knew it was low, because the only way to know is to go and look at it.
- DSTV or GOtv goes off on the day of the match because the renewal date passed.
- ChatGPT or another subscription lapses because the card was declined.
- And when it is time to pay, the money has already gone on something else.

Each time, the fix is the same: notice, find money, buy, wait, re-enter. You have to remember, and you have to have the money at that moment.

## The promise

**Set it once. Never think about it again.**

1. **Money set aside.** You put money into Constant and set it aside for each thing: ₦15,700 a month for DSTV, ₦10,000 for light, ₦5,000 for data. That money is not spent on anything else.
2. **Paid automatically.** Constant renews on the date (cable, subscriptions) or refills when it measures you are low (data, airtime, light).
3. **Told before it goes wrong.** Constant warns you when you are *likely* to run low, and when the money set aside will not cover what is coming, days before it fails, not on the morning it fails.
4. **Your money, your control.** Cancel, pause, reschedule or change any of them at any time. Withdraw your money to your bank account at any time, except an amount already being paid out right now.

## How the money works

- **One Constant account per user.** You fund it by bank transfer into your own account number from any bank app (D-022).
- **Pots.** Each thing you pay for has a pot: DSTV pot, Light pot, Data pot, ChatGPT pot. You move money between your main balance and pots, or let Constant do it on payday. A pot can only pay its own bill.
- **Covered-until.** Every pot shows how long it lasts: "DSTV covered until 15 Dec. Light covered until about 9 Nov."
- **Withdraw any time.** To a bank account in your own verified name. Money already committed to a payment in progress is the only part you can't take back (INV-36).
- **Cancel any time.** Cancelling a line stops future payments and returns its pot to your main balance. Reschedule moves the next date; pause stops it until you resume.
- **The money is held by a licensed partner, never in a Constant founder's or staff account.** Holding money people can withdraw is regulated. The partner's licence must cover it, and identity checks apply as balances grow (B4).

## Knowing before you run low

This is the feature people will feel every week. For every line, Constant estimates **the chance of running out soon**, and only speaks up when it matters:

- **Data:** "There's a 70% chance your data runs out before tomorrow evening. Autopilot will top up ₦3,500 at 300 MB." If autopilot is off: "Top up now?"
- **Light:** "Your meter will likely run out around Thursday evening, possibly as early as Wednesday night. Send a meter photo to check."
- **Money:** "Your DSTV renewal on 15 Dec is ₦2,300 short. Add money before then, or Constant will move it from your Data pot if you allow it."

How it works (`packages/rules/src/forecast.ts`):
- Usage per day is learned from measurements: data counted on the phone, meter readings, and the units in each token.
- From the average and the day-to-day spread, Constant computes the probability that what's left runs out within the next 48 hours. It also gives two dates: a cautious one (20% chance of having run out) and a likely one (50%).
- A reminder goes out when the probability reaches 60%, at most once a day per line, and never between 22:00 and 07:00 local time.
- If autopilot and the money set aside already cover it, the reminder is a calm heads-up. If not, it asks you to act.
- With less than 3 days of history it says "still learning" instead of making up a number.
- **Wallet runway** walks through every upcoming renewal and estimated refill in date order, and says which one would fail first and by how much.

All of this is plain statistics. No AI model decides anything that moves money (D-034).

## Products

| Product | How Constant knows when | How it's paid | Automatic? | Phase |
|---|---|---|---|---|
| **Cable TV** (DSTV, GOtv, StarTimes) | Renewal date and plan, from the decoder number | Vend partner renews the decoder directly | Fully, today | 1 |
| **Data & airtime** | Phone measures use + USSD balance | Vend partner credits the SIM | Fully, today (Android) | 1 |
| **Light** (prepaid electricity) | Units sold + meter readings + forecast; spare token | Token by push or SMS, keyed in | Near-fully today; fully with partnerships | 2 |
| **Subscriptions** (ChatGPT, Claude, Gemini, music, streaming) | Renewal date | Merchant-locked virtual card per subscription | Fully, once a card issuer is signed | 3 |
| **Family & remote lines** | Their phone, or a schedule | Same as above | Same as above | 3 |

### Cable TV (DSTV, GOtv, StarTimes)

The easiest product to make fully automatic, so it ships first with data.
- Add the decoder's smartcard or IUC number. Constant looks it up and shows the name, current plan and expiry date. Nothing is paid until you confirm.
- Constant renews the same plan the day before expiry, from the TV pot.
- **Plan change:** pick a new plan in the app; the next renewal uses it.
- **Price changes:** if the provider changes the price, Constant tells you before the next renewal and asks once. It never pays more than your cap without asking.
- **Pause:** travelling for a month? Pause and resume.
- Several decoders (home, shop, parents) each get their own line and pot.

### Data & airtime autopilot (your own phone)

The phone itself is the sensor, and the network credits the bundle directly.
- The Constant Android app counts the mobile data this phone has used since the last bundle. It uses Android's own data-usage counter: total bytes only, never which apps.
- It checks the network's real balance with a USSD request a few times a day, and after every purchase, to correct the count.
- It shows **"1.2 GB left, about 3 hours of video calls at your pace"**, warns you before a long call, and gives the running-low probability above.
- At your line (e.g. 300 MB), it buys your chosen bundle from the Data pot. It arrives in seconds.
- Airtime: USSD balance check, then a top-up at your line.
- iPhone can't read data usage or send USSD from an app. iPhone users get timed refills, reminders and one-tap top-up.

### Light (prepaid electricity)

A normal meter can't be read remotely, and a token has to be keyed in. Four layers get close; hardware and partnerships finish the job later (`docs/SENSING.md`):
1. **We know what went in:** every token we buy comes back with its units.
2. **We learn how fast this home uses it,** from meter photos (read on the phone) or typed readings.
3. **We ask only when it matters:** when the forecast says you're near your line, the app asks for one photo. A reading at or below the line buys immediately.
4. **Always one token ahead (optional):** a spare token waits on your phone. When the meter beeps, key it in. When it's marked used, the next spare is bought.

Timed refills on chosen days, and alert-only mode, remain available.

#### Electricity coverage

| DisCo | Area (main) | Wave |
|---|---|---|
| IKEDC (Ikeja Electric) | Lagos: mainland and north | 1 |
| EKEDC (Eko) | Lagos: island and south | 1 |
| EEDC (Enugu) | Enugu, Anambra, Ebonyi, Imo, Abia (except Aba) | 1 |
| AEDC (Abuja) | FCT, Niger, Kogi, Nasarawa | 1 |
| IBEDC, PHED, BEDC, KEDCO, KAEDCO, JED, YEDC, Aba Power | Rest of the country | 2, in order of sign-ups |

Areas are a guide; the meter lookup decides. Each DisCo passes its own gate before it is switched on (D-038).

### Subscriptions, including AI tools

ChatGPT, Claude, Gemini, music and streaming renew every month without you doing anything.
- Each subscription gets its own virtual card, locked to that one merchant and capped at its monthly price.
- Constant funds the card from the subscription's pot the day before renewal; the rest of the month the card holds nothing.
- You see the naira charged and the dollar price, with the rate used. This is the one product where a dollar price is shown.
- The blocker is the card rail, not the automation: a licensed card-issuing partner is needed (D-039).

### Family and remote lines

Mum's data, the family house meter, the shop's DSTV: same engine, a different person at the other end. If they install the app, their phone is the sensor. If not, they get timed refills, LOW by SMS or WhatsApp, and tokens by SMS. Diaspora families and landlords live here.

## How tokens and messages reach you

You choose: **WhatsApp, Telegram, SMS or email**, in your order of preference, and the person at the meter can have their own choice. If the first channel fails, Constant tries the next, and SMS is always the last resort for a token. Every resend is the same token, never a new purchase. Details: `docs/DELIVERY.md` (D-054).

## Who it's for first

Urban Nigerians with an Android phone, a data plan, a decoder and a prepaid meter at home. Data, airtime and cable work nationwide from day one. Electricity opens DisCo by DisCo (D-038).

## Principles

1. **Measure where we can, estimate honestly where we can't, and never pretend.** Every number shown says whether it is measured or estimated.
2. **Running out costs more than buying early,** except where bundles expire (data), which is only bought on measurement.
3. **The owner's limits are absolute.** Caps, pots, minimum gap, freeze. No estimate, model or AI can move them.
4. **Your money is yours.** Withdraw, cancel, pause or reschedule at any time.
5. **No LLM on the money path.**
6. **Pay only when we deliver.**

## What Constant never does

- Buy data on a guess.
- Claim to read a meter it can't read.
- Spend past a cap, take from one pot for another without your permission, or hold money you can't withdraw.
- Read your messages, contacts, or which apps you use.
