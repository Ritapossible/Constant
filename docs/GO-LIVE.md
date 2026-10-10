# Go live: one cable bill, end to end

The next build from PLAN: a DSTV, GOtv or StarTimes renewal stored on a server, paid with real money, with the result delivered to the user. Code is done and tested; what's left is accounts, keys and a sandbox run. Do the steps in order. Nothing is paid until step 7.

## 1. Accounts (founder)

| Account | What to get | Where it goes |
|---|---|---|
| **VTpass** sandbox, then live | API key, public key, secret key (API Keys tab; the secret is shown once). Whitelist DSTV, GOtv, StarTimes. Live needs a funded VTpass wallet and your server IP whitelisted if they ask. | Render group `constant-shared` |
| **Paystack** (test, then live) | Secret key. Ask Paystack to enable **Dedicated Virtual Accounts** for the business. | Render `constant-api` |
| **Privy** | App secret, and the **verification key** (App settings). The App ID is already in Vercel. | Render `constant-api` |
| **Resend** (email) | API key, and a verified sending domain once you have one. | Render `constant-worker` |
| **Termii** (SMS, optional now) | API key, sender ID "Constant" (registration takes days). | Render `constant-worker` |

Legal (PLAN B4, D-050): Paystack's written confirmation that holding users' naira for bills fits their licence, before real users fund.

## 2. Deploy the backend (Render, Frankfurt)

1. render.com → New → **Blueprint** → this repo. It creates `constant-db` (Postgres 16), `constant-api` and `constant-worker` from `render.yaml`.
2. Fill the prompted values. Generate the two encryption keys on your computer: `openssl rand -base64 32`, once for `REF_ENCRYPTION_KEY` and once for `REF_HMAC_KEY`. **Keep a copy in a password manager.** Lose them and stored decoder numbers can't be read.
3. `PRIVY_VERIFICATION_KEY`: paste the whole key including the `-----BEGIN PUBLIC KEY-----` lines.
4. `VEND_FALLBACK_PHONE`: a Constant phone number (VTpass needs one when a user has none).
5. Deploy. Both services run the database migrations on start. Check `https://<constant-api>.onrender.com/health` shows `{"ok":true}`.

## 3. Point the partners at the API

- **VTpass** callback URL: `https://<constant-api>.onrender.com/webhooks/vtpass/<VTPASS_WEBHOOK_TOKEN>` (Render generated the token; copy it from the service's Environment tab).
- **Paystack** webhook URL (Settings → API Keys & Webhooks): `https://<constant-api>.onrender.com/webhooks/paystack`.

## 4. Point the app at the API

Vercel → Project → Settings → Environment Variables → `NEXT_PUBLIC_API_URL` = `https://<constant-api>.onrender.com` → Redeploy. In the app, adding Cable TV now finds the decoder, and Money shows a naira account.

## 5. Sandbox run (VTpass sandbox + Paystack test mode)

1. Sign in, Money → get an account number (Paystack test bank).
2. Fund it: Paystack test mode → simulate a transfer to the account (or use their test transfer tool).
3. Bills → Cable TV → DSTV → sandbox smartcard `1212121212` (VTpass's documented success number) → confirm.
4. Turn payments on (step 7 below), then make the renewal due now:
   `UPDATE lines SET next_run_at = now() WHERE id = '<line id>';`
5. Within 5 minutes: an order appears, the worker pays, the balance drops by the renewal price once, the line moves to next month, and an email arrives.
6. Try VTpass's other sandbox numbers for pending and failure, and check the app: pending is rechecked, failure takes no money and says so.
7. **Watch for one thing:** if the decoder lookup shows the price as "Shown at renewal", VTpass's lookup isn't returning `Renewal_Amount` for that provider. Constant will not renew without a price from the provider (it never guesses), so that needs a small change: use the matching plan price from VTpass's plan list instead.

## 6. Check before real money

- [ ] `ops_alerts` is empty, or every row is understood.
- [ ] `SELECT user_id, SUM(amount_minor) FROM ledger_entries GROUP BY 1` matches what the app shows.
- [ ] A transfer replayed from the Paystack dashboard credits once.
- [ ] Someone other than the founder has done steps 5.1–5.5 on their own phone.

## 7. Payments on / off

Vending starts **off**. To turn it on (Render → constant-db → Connect → psql):

```sql
UPDATE system_flags SET value = true, changed_by = '<your name>', reason = '<why>', changed_at = now() WHERE key = 'vending_enabled';
```

Set it back to `false` to stop all payments at once. The worker turns it off itself if VTpass says our balance is empty, and writes an `ops_alerts` row.

## 8. Live

Swap `VTPASS_BASE_URL` to `https://vtpass.com/api` with live keys, Paystack live secret and `PAYSTACK_PREFERRED_BANK=wema-bank` (or `titan-paystack`), fund the VTpass wallet, and repeat step 5 with your own decoder and ₦ before inviting anyone. When that works, the "Preview" badge disappears on its own (the app shows it while payments are paused).
