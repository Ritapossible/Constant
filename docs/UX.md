# UX, accessibility and adoption

Constant has no app. Its interface is a handful of text messages and one web page. That makes every word count.

## Who we design for

| Person | Phone | What they need |
|---|---|---|
| **Owner**: shop owner, landlord, adult child paying for parents' house, employer paying for a staff room. Often in another city or abroad. | Smartphone, WhatsApp. | To stop thinking about the light, and to know when money moved. |
| **Site phone**: caretaker, shop attendant, parent, security man. | Any handset. Possibly a basic phone with no data. Possibly shared. | A token that works, in a message they can read and key in. Nothing to install, nothing to sign up for. |

Design for the site phone first. If it works on a basic Nokia with SMS, it works everywhere.

## Message rules

1. **Say what happened, then what to do next.** "Thursday's N15,000 did not run. N4,000 left. Transfer to 0123456789 Wema Bank to restart." Never a bare error.
2. **Always answer.** Every inbound message gets exactly one reply, even if it is the short help. Silence feels like failure.
3. **Name the meter the way people do:** "meter ending 6781". Never the full number.
4. **Days as words, times as people say them:** "Monday", "7:00am". Never ISO dates. Never "next_run_at". Owners whose phone number is outside the market add the zone: "7:00am Lagos time" (D-021).
5. **Fee up front:** the owner sees the fee before funding and on every paid message: "I will buy ₦15,000 each time, plus ₦100 Constant fee." Never a surprise deduction (D-020).
6. **Money:** local symbol on WhatsApp and web (`₦15,000`), letter on SMS (`N15,000`, D-019). Thousands separators. No kobo unless non-zero. Never a second currency.
7. **Tokens:** in groups of four, on their own, so they can be read aloud over a call: `1234 5678 9012 3456 7890`. When there are key-change tokens, number them: "Key in 1 of 3".
8. **Short.** Every SMS template is one GSM-7 segment (160 characters). WhatsApp messages under 300 characters.
9. **Plain words.** No "transaction", "mandate", "vend", "settled". Say "paid", "bought", "token".
10. **Banned words** (enforced in CI): blockchain, crypto, wallet, seed, gas, USDC, XLM, Stellar, dollar.
11. **One question per message** during onboarding, and repeat the answer back ("I will buy ₦15,000.") before moving on.

All strings live in `packages/copy`, keyed by message id and locale, with a test that renders every template with the longest realistic values and checks length and encoding.

## Accessibility

- **SMS works for everyone:** blind users with screen readers, basic phones, no data. It is the delivery channel for the token, not WhatsApp.
- **Receipt page** (`/r/:id`): server-rendered HTML, no JavaScript needed, under 30 KB, loads on 2G and in Opera Mini. Semantic headings, WCAG 2.2 AA contrast, text resizes to 200% without breaking, and the status is text rather than only a colour. `lang` attribute set per locale.
- **Numbers for screen readers:** the token on the receipt page (last 4 only) is marked up so it is read digit by digit.
- **Low literacy:** fixed short messages with the same structure every time, so they can be recognised rather than read. Voice notes and USSD are later channels, not v1 (see PLAN).

## Languages

English at launch. Nigerian Pidgin is next because it has the widest reach among site-phone users. Then Yoruba, Hausa and Igbo; Twi, Swahili, isiZulu and Afrikaans come with their markets.

Translations are written and checked by native speakers, never machine-generated at runtime. Commands stay the same English words in every locale (LOW, SKIP, STOP) so support can read any conversation. Local-language aliases can be added per locale as exact words.

## Adoption

- **The owner onboards in WhatsApp in under three minutes.** Meter → confirm name → site phone → amount → days → funding details. No web form, no password, no ID upload beyond what the licensed funding partner requires.
- **The first token is the demo.** Offer "buy one now" at the end of onboarding, so the owner sees the site phone receive a token that works before they trust the schedule.
- **Trust signals** in every funding message: the name of the licensed bank holding the money, and "This meter will not buy until it arrives."
- **The site phone learns Constant from the first token SMS.** It says who it is from: "From Constant for [owner first name]".
- **Referral is the growth loop.** Owners of one meter usually know others who pay for meters remotely. A shareable onboarding link (wa.me deep link with a code) comes after the pilot.
- **Friday note** only when something happened. Quiet weeks stay quiet.

## Copy examples (English)

| Id | Channel | Text |
|---|---|---|
| `token_ready` | SMS | `Constant: Token for meter ending 6781, N15,000. Key in: 1234 5678 9012 3456 7890. Receipt: constant.ng/r/Ab3kQ9` |
| `owner_paid` | WhatsApp | `Paid ₦15,000 for meter ending 6781 (+₦100 fee). Next is Thursday. ₦34,900 left.` |
| `site_low_notice` | WhatsApp | `Mum's phone asked for light. Paid ₦15,000 for meter ending 6781.` |
| `low_too_soon` | both | `Last buy was too recent. Nothing bought.` |
| `insufficient` | WhatsApp | `Thursday's ₦15,000 for meter ending 6781 did not run. ₦4,000 left.` |
| `missed` | WhatsApp | `Monday's ₦15,000 for meter ending 6781 did not run because of a problem on our side. Next is Thursday. Send LOW to buy now.` |
| `schedule_site_number` | both | `This meter buys on its days. Send LOW to buy now, or SKIP to cancel the next one.` |
| `not_a_customer` | both | `Constant buys light for meters an owner already added.` |
