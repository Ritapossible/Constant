# Constant — product

> Supersedes the scope of `docs/SPEC.md` (the original electricity-only, calendar-only v1). The money-safety rules from that spec still hold everywhere.

## The problem

Nigeria runs on prepaid. Data, airtime, electricity and TV are all bought in advance, and all of them run out without warning:

- The data finishes in the middle of a WhatsApp call. You only find out when the call drops.
- The meter at home finishes at night. Nobody knew it was low, because the only way to know is to go and look at it.
- The subscription lapses because the card was declined or the date passed.

Each time, the fix is the same: notice, find money, buy, wait, re-enter. Constant's job is to do that before you notice.

**One line:** Constant keeps your prepaid life from running out. It watches what it can measure, refills inside limits you set, and tells you what it spent.

## Principles

1. **Measure where we can, estimate honestly where we can't, and never pretend.** Every number shown says whether it is measured or estimated.
2. **Running out costs more than buying early.** Units and tokens don't expire, so where we are unsure we buy a little early, never late. Data is the exception (bundles expire), so data is only bought on measurement.
3. **The owner's limits are absolute.** Cap per line, cap per week, minimum gap, freeze with one word. No estimate, model or AI can move them.
4. **No LLM on the money path.** Forecasts are plain, bounded statistics. They are inputs to `packages/rules` and never decide on their own.
5. **Pay only when we deliver.**

## Products

### 1. Data & airtime autopilot (your own phone) — fully automatic today

The phone itself is the sensor, and the network credits the bundle directly, so nobody has to type anything in.

- The Constant Android app counts the mobile data this phone has used since the last bundle was bought. It uses Android's own data-usage counter: total bytes only, never which apps.
- It checks the network's real balance with a USSD balance request a few times a day, and right after every purchase, to correct the count.
- It shows **"1.2 GB left, about 3 hours of video calls at your pace"** and warns you before you start a long call.
- At your line (e.g. 300 MB, or "less than 1 hour of calls"), it buys your chosen bundle from the wallet. It arrives on the SIM in seconds.
- Airtime works the same way: a USSD balance check, then a top-up at your line.
- iPhone cannot read data usage or send USSD from an app. iPhone users get timed refills and "top up now" (ROADMAP).

### 2. Light (prepaid electricity) — near-automatic today, fully automatic later

Today a normal meter can't be read remotely and a token has to be keyed in. We get as close as possible with four layers, and add hardware and utility partnerships later (`docs/SENSING.md`):

1. **We know what went in.** Every token we buy comes back with its kWh units.
2. **We learn how fast this home uses it.** Readings from the meter (a photo in the app read on the phone, or a number by text) give us a usage rate. That rate gives a "runs out around Thursday evening" estimate.
3. **We ask only when it matters.** No daily nagging. When the estimate gets near your line, the app asks for one photo of the meter. A reading at or below your line buys immediately.
4. **Always one token ahead (optional).** Constant keeps an unused token waiting on your phone. When the meter beeps low or goes off, key it in at once: no payment, no waiting. When you mark it used, the next spare is bought. An estimate can be wrong; a spare token in hand still keeps the light on.

You can also keep the original modes: timed refills on chosen days (the calendar), and alert-only.

### 3. Family and remote lines

Mum's data, the family-house meter, the shop meter: same engine, a different person at the other end. If that person installs the app, their phone is the sensor. If not, they get timed refills, LOW by SMS or WhatsApp, and the token by SMS. This is where the original diaspora and landlord use case lives.

### 4. Bills with a due date (TV, then subscriptions)

DSTV and GOtv have known expiry dates, so renewing them is simple scheduling with nothing to sense. Later: subscriptions such as AI tools (ChatGPT, Claude, Gemini), music and streaming, paid in naira through a virtual card for each subscription, locked to one merchant and capped at that subscription's price. That card can only ever pay that one bill. This depends on a licensed card-issuing partner (ROADMAP Phase 4).

## Who it's for first

People like the founder: urban Nigerians with an Android phone, a data plan and a prepaid meter at home, starting in Lagos (IKEDC, then EKEDC). They feel both pains weekly, and they can install an app on the phone that is also the sensor. Diaspora owners and landlords come next, as "remote lines" (D-030).

## What Constant never does

- Buy data on a guess. Data is bought only on a measured or USSD-confirmed balance.
- Claim to read a meter it can't read. The app says "estimated" until a reading or a sensor confirms it.
- Spend past a cap, or move money between lines without the owner.
- Read your messages, contacts, or which apps you use.
