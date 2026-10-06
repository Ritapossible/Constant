# Roadmap

Each phase has a goal, what ships, and a gate that must be met before the next phase starts. Methods marked 🔴 in `docs/SENSING.md` live in the later phases.

## Phase 0 — Prove it (weeks 0–6)

Goal: evidence that people want refills done for them, and that our sensors are accurate enough.

- **Data sensor test.** A bare Android build, with no money involved, that shows "data left" from the usage counter plus USSD. The founder and 20 testers on MTN, Airtel, Glo and 9mobile. Compare against the network every day.
- **Light concierge.** 10 homes. The founder buys tokens by hand, asks for a meter photo when the forecast says so, and runs the spare-token habit. Measure: outages avoided, readings sent when asked, spares keyed within an hour.
- **Partners.** VTpass sandbox for data, airtime and electricity. Paystack (or Monnify) virtual accounts with written confirmation of the use case.
- **Bundle stacking.** For each network: which plans add to an active bundle, which replace it.

**Gate:** data estimate within 10% of the network's balance on 9 of 10 checks, across all four networks. At least 7 of 10 light homes keep the spare-token habit for 4 weeks.

## Phase 1 — Pots, cable TV, data & airtime autopilot (months 2–4)

Goal: set it once and never think about it. Nobody using Constant runs out of data mid-call or loses DSTV on renewal day.

- Android app: onboarding, one account per user funded by bank transfer, **pots per line**, covered-until home screen, **withdraw / cancel / pause / reschedule at any time** (D-040).
- **Cable TV** (DSTV, GOtv, StarTimes) renewal before expiry (D-041).
- Data-left display with "time at your pace", warning before long calls, auto top-up at the line, airtime top-up, caps, freeze.
- **Running-low probability reminders** and **wallet runway** with a payday plan (D-042, D-043).
- Backend: the money path from PLAN steps 2, 3 and 8 (ledger, vend worker, reconciliation), with VTpass data and airtime.
- WhatsApp for receipts and STOP, BALANCE, LOW.

**Gate:** 500 weekly active users; fewer than 1 in 200 sessions end in "ran out" for active autopilot users; no unexplained ledger line.

## Phase 2 — Light (months 3–6, overlaps Phase 1)

Goal: homes on Constant stop going dark by surprise.

- Meter onboarding for wave-1 DisCos (IKEDC, EKEDC, EEDC, AEDC; D-038), each behind its own gate, photo and typed readings, usage-rate forecast, ask-when-near prompts, buy on reading, spare token, optional buy-early-on-estimate, schedule mode, alert-only mode.
- Token delivery by push and SMS, DONE confirmation, receipt page.

**Gate:** in homes with the spare token on, unplanned outages fall by at least 80% compared with the 4 weeks before joining.

## Phase 3 — Family, remote lines, TV, subscriptions (months 6–9)

- Lines for other people: Mum's data (her app as sensor, or timed), the family house meter (the original diaspora product), shop meters.
- iPhone app: timed refills, one-tap top-up, light readings by photo.
- **Subscriptions, including AI tools** (D-039): monthly renewal of ChatGPT, Claude, Gemini and similar on merchant-locked virtual cards. Only if the card-issuing partner (PLAN B9) is signed; otherwise it moves to Phase 4.
- Wave-2 DisCos, in order of sign-ups.
- Pidgin. More DisCos.
- **Grid-supply-aware forecast** experiment (SENSING E7).

## Phase 4 — Constant Eye hardware (months 9–18)

**Constant Eye** (SENSING E8–E10):
- Prototype the pulse reader, the clamp and the beep detector with 20 homes. Measure accuracy, battery life, connectivity and installation cost.
- Offer it as a monthly rental, so the customer doesn't pay for hardware upfront.
- Gate to scale: under ₦50,000 all-in per home, 6 months' battery or mains backup, no DisCo-equipment contact, and a clear legal opinion.

**Subscriptions** land here only if Phase 3 had no card-issuing partner (D-039).

## Phase 5 — Partnerships that remove the human (18 months +)

- **DisCo or meter-maker smart-meter integration** (SENSING E11). Real balance and remote token loading: no keying in, ever. Start conversations in Phase 1, because they are slow.
- **Mobile network APIs** (SENSING D7). Balance and network-side auto top-up with consent; covers iPhone.
- **New countries** (`docs/EXPANSION.md`): Kenya (M-Pesa, KPLC tokens), Ghana (MoMo), South Africa.

## What we will not do

- Buy data on a forecast.
- Wire anything into a DisCo meter, or touch DisCo equipment.
- Read SMS, contacts or per-app usage.
- Put an LLM on the money path.
- Build hardware before the software-only light product has a retention signal.
