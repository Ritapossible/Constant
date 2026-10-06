# Sensing: how Constant knows what's left

Every automatic buy needs two things: a **sensor** (how much is left) and an **actuator** (how the purchase reaches the line). This file lists every option we know of, how good it is, and when we can use it.

Feasible: ✅ now · 🟡 needs a pilot or partner · 🔴 not possible today

## Mobile data and airtime

The network knows the balance and credits a bundle straight to the SIM, so the actuator is solved: a VTU partner (VTpass) buys the bundle and it lands on the SIM. The job is sensing.

| # | Method | What it gives | Accuracy | Feasible | Notes |
|---|---|---|---|---|---|
| D1 | **On-phone usage counter** (Android `NetworkStatsManager`, user grants usage access) | Mobile bytes used by this phone, including hotspot, since any moment | High minute to minute; drifts from the network's count over days | ✅ | Total bytes only. Dual-SIM attribution varies by Android version; test on popular Tecno/Infinix/Itel/Samsung models. |
| D2 | **USSD balance check from the app** (Android `sendUssdRequest`) | The network's own balance, per bundle | Exact when it parses | ✅ | Codes and reply formats differ by network and change. Keep parsers small and tested against recorded replies. Run a few times a day and after each purchase, not every minute. |
| D3 | D1 + D2 together | Live estimate, recalibrated against the network | Within a few % between checks | ✅ | **The product.** Buy at a safety line (default 300 MB), never at zero. |
| D4 | Purchase records | Size of each bundle we bought | Exact | ✅ | Gives the starting point after each refill. |
| D5 | Network warning SMS ("You have used 80%…") | A threshold event | Exact | 🔴 | Reading SMS is restricted by Google Play policy for apps that aren't the default SMS app. Do not depend on it. |
| D6 | iPhone | Nothing automatic | — | 🔴 | iOS gives apps neither cellular usage nor USSD. iPhone gets timed refills and one-tap "top up now". |
| D7 | **Network (MNO) APIs:** balance query and direct auto top-up with the subscriber's consent | Exact balance, network-side triggers | Exact | 🔴 → 🟡 | Partnership with MTN, Airtel, Glo or 9mobile, or through operator API programmes (GSMA Open Gateway / CAMARA style). Removes the app as sensor and works on iPhone. Phase 5. |

Things to test before promising "never cut mid-call":
- **Stacking.** What happens when a bundle is bought while one is still active: does it add, queue or replace? This is different per network and plan type. The autopilot must only buy plans that add.
- **Expiry.** Data bundles expire, so buying early can waste money. That is why data is bought only on measurement (D3), never on a forecast.
- **Out-of-bundle charges.** Some networks start charging airtime when data runs out. The autopilot should beat that line.

## Prepaid electricity (STS keypad meters)

A normal meter keeps its credit inside itself and does not report it. Tokens must be keyed in at the meter or its indoor keypad (CIU). Two things to solve: sensing, and the last metre.

| # | Method | What it gives | Accuracy | Feasible | Notes |
|---|---|---|---|---|---|
| E1 | **Purchase records** | kWh units in every token we sold | Exact | ✅ | Starting point. |
| E2 | **Typed reading** (SMS, WhatsApp, app) | Units left right now | Exact when sent | ✅ | Needs a person. |
| E3 | **Photo reading in the app** (text recognition on the phone) | Units left, from a photo of the display | High; confirm when unsure | ✅ | One tap instead of typing. The photo is read on the phone; only the number is sent. |
| E4 | **Usage-rate forecast** from E1–E3 | "Runs out around Thursday evening" | Medium; weather, AC and visitors move it | ✅ | Plain statistics with a confidence range, per home. Decides *when to ask*, not whether to buy (except E5). |
| E5 | **Buy early on forecast** (opt-in) | A buy when the pessimistic estimate reaches the line | Errs early by design | ✅ | Allowed for electricity only, because units don't expire. Weekly cap still applies. |
| E6 | **Always one token ahead** (spare token) | A token waiting before the meter runs out | Not a sensor: a buffer | ✅ | Most meters beep or show a warning when low. The person keys the spare at once. Keeps the light on even when every estimate is wrong. Costs one token's worth of float. |
| E7 | **Grid-supply-aware forecast** | Usage only counted for the hours the grid was on | Better than E4 where supply is patchy | 🟡 | Supply hours from the household's phones (charging starts and stops at home), the home router going offline, or our own device. Needs care and consent. Phase 3 experiment. |
| E8 | **Constant Eye: pulse reader** | Real-time kWh used | High (it counts the meter's own pulses) | 🟡 | Most keypad meters have an LED that flashes per unit used (marked e.g. "1600 imp/kWh"). A light sensor over it, plus a small board with a SIM or Wi-Fi and a battery, reports usage. Nothing is wired into the meter. Works only where the meter is reachable indoors. |
| E9 | **Constant Eye: clamp sensor** at the house's fuse box | Real-time kWh used | Good (a few %) | 🟡 | For split meters, where the measuring unit is on the pole and only the keypad is indoors. Fitted by an electrician on the home's side of the meter, so it never touches DisCo equipment. |
| E10 | **Low-beep detector** | An event: "meter is low" | Exact for the event | 🟡 | A tiny device that listens for the meter's low-credit alarm. Cheapest hardware; triggers a buy or a spare-token prompt. Worth a prototype. |
| E11 | **DisCo / meter-maker smart-meter integration** | Real balance, and **remote token loading** | Exact | 🔴 | Smart (AMI) meters can report balance and accept credit remotely, but only through the DisCo's or the meter maker's system. A partnership with a DisCo or meter maker, under NERC rules. **The only way to remove keying in.** Phase 5. |
| E12 | Polling a vend partner for "units left" | — | — | 🔴 | Vend partners validate meters and sell tokens. They do not know the balance. Don't build on it. |
| E13 | Pressing the meter's keys robotically | — | — | 🔴 | Fragile, and touches DisCo equipment. No. |

### The last metre: getting the token into the meter

Until E11 exists, a person keys the token in. We make that as easy as possible:
- Push notification with the token in groups of four, a copy button, and a read-aloud button.
- SMS copy for basic phones.
- The person replies DONE or taps "Keyed in". If they don't, we remind them once and tell the owner.
- With the spare token (E6), keying happens when the meter beeps, not when the money arrives.

## How readings feed the rules

Every reading is stored with its **source** and **time**: `typed`, `photo`, `usage_counter`, `ussd`, `device`, `utility_api`, `forecast`. `packages/rules` treats them differently:

| Source | Can trigger an automatic buy? |
|---|---|
| `ussd`, `utility_api`, `device` | Yes, at or below the line. |
| `typed`, `photo` | Yes, at or below the line (the person is the sensor). |
| `usage_counter` (data) | Yes, only if the last `ussd` calibration is recent (default under 24h). |
| `forecast` | Electricity only, and only when the owner turned on "buy early on estimate" (E5). Never for data. |
| No reading at all (silence) | Never. Silence still buys nothing. |

Every one of these still passes the same caps, gap, freeze, balance and one-open-order checks in `decideSchedule`'s successor.
