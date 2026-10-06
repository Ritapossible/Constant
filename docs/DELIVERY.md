# Delivery: WhatsApp, Telegram, SMS, email

Constant sends tokens, codes and receipts on the channel each user chooses (D-054). The rule that picks the channel and falls back is `packages/rules/src/delivery.ts`.

## What gets delivered

| Item | Example | Needs to arrive fast? |
|---|---|---|
| **Electricity token** (and key-change tokens, in order) | `1234 5678 9012 3456 7890` | Yes. Someone is waiting to key it in. |
| **Codes and PINs** from subscriptions or vouchers that produce one | A voucher or exam PIN | Yes |
| **Renewal confirmations** (cable, data, airtime, AI subscriptions) | "DSTV Compact renewed until 15 Dec" | No |
| **Reminders** (running low, wallet short) | "70% chance your data runs out before tomorrow evening" | Within the hour |
| **Receipts and monthly statements** | PDF or link | No |

## The four channels

| Channel | How the user turns it on | Good for | Watch out for |
|---|---|---|---|
| **WhatsApp** (Cloud API) | Opt in with their WhatsApp number at sign-up. | Most Nigerian users; rich messages; commands (BALANCE, LOW, STOP). | Outside the 24-hour window only pre-approved templates can be sent (`token_ready`, `renewed`, `running_low`, `wallet_short`). Template costs per message. |
| **Telegram bot** | Tap "Connect Telegram" in the app; it opens `t.me/<bot>?start=<one-time code>`. The code links that chat to their account. | Free to send, fast, no template approval, works well for diaspora and crypto users. | The bot can only message people who started it. Telegram doesn't give us their phone number, so linking is always by one-time code, never by typing a phone number. |
| **SMS** | Always available for any phone number we have. | Basic phones, no data, the person at the premises. The floor for every token. | Plain text only (no "₦", D-019); one GSM-7 segment; cost per message; delivery receipts vary by network. |
| **Email** | Add and verify an email address. | Receipts, monthly statements, a written record of every token. | Slow to be seen; no reliable "delivered" signal. Never the only channel for an urgent token unless the user chose it. |

Each person can have different choices. The owner might pick Telegram for themselves, while the meter's site phone gets SMS.

## How a token is sent

1. The token is stored (encrypted) before any message is sent (INV-11).
2. Constant tries the first channel in the user's order that is linked.
3. If the provider reports it failed, the next channel is tried at once. If it was accepted but not confirmed as delivered within 5 minutes (configurable), the next channel is tried.
4. **SMS is always the last resort** for a token, even if the user didn't list it, as long as there is a phone number.
5. Every attempt sends **the same stored token**. Delivery never triggers a new purchase.
6. If every channel fails, the owner and support are told, and the token stays available in the app and on the receipt page (last 4 digits only on the page).
7. "Resend my token" (a button in the app, or `TOKEN` on WhatsApp or Telegram) resends the stored token on the channel it's asked from.

## Message shape (same facts on every channel)

```
Constant: token for meter ending 6781, N15,000
1234 5678 9012 3456 7890
Receipt: constant.ng/r/Ab3kQ9
```

- Groups of four digits so it can be read aloud or typed easily. Key-change tokens are numbered "1 of 3".
- WhatsApp and Telegram add a **Copy** button. Telegram can also send the token as a single `code` block, which copies with one tap.
- Email: the token appears **in the body only, never in the subject line**, plus a PDF receipt.

## Security

- The full token never appears in a URL, a log line, an email subject or a push notification preview on the lock screen (INV-14). The receipt page shows the last 4 digits only.
- Telegram links use a one-time code that expires in 10 minutes. Unlinking is one tap, and links again need a new code.
- Inbound commands from WhatsApp and Telegram are checked: WhatsApp by `X-Hub-Signature-256`, Telegram by the secret token set on the webhook. Raw payloads are stored before routing, as for every inbound channel.
- The same command rules apply on every channel: the person at the premises can only send LOW, SKIP and TOKEN (INV-10).

## Commands on WhatsApp and Telegram

`BALANCE`, `LOW`, `SKIP`, `STOP`, `START`, `TOKEN` (resend the last token), `HELP`. Same exact-word rules as `packages/rules/src/commands.ts`. On Telegram they also work as `/balance`, `/low`, and so on.
