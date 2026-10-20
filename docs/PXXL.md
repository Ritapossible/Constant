# Testing the backend on Pxxl (free plan)

For testing only: sandbox and test keys, testnet, no real customers. Pxxl's free plan has no database backups, and
its memory and CPU limits aren't published. Move to a paid plan with backups (Pxxl Pro, or Render with
`render.yaml`, see GO-LIVE.md) before real money goes through it. Decision: D-078.

What runs where:

| Part | Where | Notes |
|---|---|---|
| Website | Vercel (unchanged) | Points at the Pxxl API with `NEXT_PUBLIC_API_URL` |
| API | Pxxl Web Service, base directory `apps/api` | Settings in `apps/api/pxxl.toml` |
| Worker | Pxxl Web Service, base directory `apps/worker` | Settings in `apps/worker/pxxl.toml`; answers `/health` |
| Database | Pxxl managed PostgreSQL | Free plan includes one |

The free plan allows 2 web service projects and 1 database: exactly this. Both services run in the same region as
the database (Europe Central, Germany, the default).

## 1. Account and database

1. Sign up at [pxxl.app](https://pxxl.app) with GitHub. Install the Pxxl GitHub App and give it access to
   `Ritapossible/Constant`.
2. **Database → New → PostgreSQL.** Name it `constant-db`. Wait until it shows healthy.
3. Open its **Connection** tab and copy the connection URL. That is `DATABASE_URL` for both services. If Pxxl
   offers **Add DATABASE_URL** to a project, use it instead of pasting.

## 2. Generate the two encryption keys (once)

On a computer: run `openssl rand -base64 32` twice, one for `REF_ENCRYPTION_KEY`, one for `REF_HMAC_KEY`.
Without a computer, any password manager's generator works: 32 random bytes, base64 (44 characters ending in `=`).
**Save both in a password manager.** The API and the worker must have the same two values. Lose them and stored
decoder and meter numbers can't be read.

## 3. The API

1. **Deploy → GitHub → `Ritapossible/Constant`**, branch `main`.
2. **Base directory:** `apps/api`. Pxxl reads `apps/api/pxxl.toml`: check that review shows the install, build and
   start commands from that file, Node 22 and port 8080. Region: Europe Central.
3. **Secrets** (environment variables):

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | from step 1 |
| `REF_ENCRYPTION_KEY`, `REF_HMAC_KEY` | from step 2 |
| `WEB_ORIGINS` | `https://constant-units.vercel.app` |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_VERIFICATION_KEY` | Privy dashboard → your app. The secret stays here, never in Vercel |
| `VTPASS_BASE_URL` | `https://sandbox.vtpass.com/api` |
| `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, `VTPASS_SECRET_KEY` | your VTpass **sandbox** keys |
| `VTPASS_WEBHOOK_TOKEN` | any random string of 16+ characters (a password generator) |
| `PAYSTACK_SECRET_KEY` | your Paystack **test** secret key (`sk_test_…`) |
| `PAYSTACK_PREFERRED_BANK` | `test-bank` |
| `CARD_TOPUPS` (optional) | `true` to try card, USSD and QR top-ups in Paystack test mode |

4. Deploy. When it's live, open `https://<your-api>.pxxl.app/health`: it should answer `{"ok":true}`. Copy the
   API's address.

## 4. The worker

1. **Deploy → GitHub → `Ritapossible/Constant`** again (a second project), branch `main`.
2. **Base directory:** `apps/worker`. Review shows the commands from `apps/worker/pxxl.toml`, Node 22 and port 8081.
   It doesn't need a domain; if Pxxl gives it one anyway, that's harmless (it only answers `/health`).
3. **Secrets:**

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL`, `REF_ENCRYPTION_KEY`, `REF_HMAC_KEY` | **the same values as the API** |
| `VENDING_PROVIDER` | `vtpass` |
| `VTPASS_BASE_URL`, `VTPASS_API_KEY`, `VTPASS_PUBLIC_KEY`, `VTPASS_SECRET_KEY` | the same sandbox values as the API |
| `VEND_FALLBACK_PHONE` | a phone number of yours, e.g. `08012345678` (VTpass needs one on each request) |
| `MESSAGING_PROVIDER` | `fake` while testing (messages are logged, not sent). Later: `TERMII_API_KEY` and/or `RESEND_API_KEY` + `EMAIL_FROM` instead |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PREFERRED_BANK` | the same test values as the API |

Leave out everything about dollars, chains and Stellar for now: those parts stay off when their keys are absent.

4. Deploy. The worker's log should say `worker started`, and its `/health` should answer `{"ok":true,…}` within a
   minute. If `/health` says `"ok":false`, the worker started but its loop stopped: read the log.

### Turning on email (when you're ready)

The worker sends email through [Resend](https://resend.com) (free: 3,000 a month, 100 a day). Resend only delivers to
other people's inboxes from a domain you own and have verified; until then it sends only to your own address.

1. Own a domain (e.g. `constantunits.com`). Any registrar works; buying it in Vercel puts its DNS in Vercel too.
2. **Resend → Domains → Add domain**: use a subdomain such as `mail.constantunits.com`, region **Ireland (eu-west-1)**.
   Add the DNS records Resend shows (in Vercel: Domains → your domain → DNS Records) and wait until it shows Verified.
3. **Resend → API Keys → Create**: permission *Sending access*, that domain only.
4. On the **worker** in Pxxl: remove `MESSAGING_PROVIDER`, then add

| Name | Value |
|---|---|
| `RESEND_API_KEY` | the key from step 3 (`re_…`) |
| `EMAIL_FROM` | `ConstantUnits <hello@mail.constantunits.com>` |
| `EMAIL_REPLY_TO` | `constantunitshq@gmail.com`, so replies reach a person |
| `OPS_EMAIL` (optional) | `constantunitshq@gmail.com`, for alerts to you |

Redeploy the worker. A user who signed in with email or Google gets receipts and warnings at that address.

## 5. Point the website at it

In **Vercel → constant-units → Settings → Environment Variables**: set `NEXT_PUBLIC_API_URL` to the API's address
from step 3 (no trailing slash), then **Redeploy**. The app's Money screen then shows the naira balance and account
number from the API.

## 6. Webhooks (test mode)

- **Paystack** (Settings → API Keys & Webhooks, *test* mode): webhook URL `https://<your-api>/webhooks/paystack`.
- **VTpass** sandbox callback: `https://<your-api>/webhooks/vtpass/<VTPASS_WEBHOOK_TOKEN>`.

## Telegram (works before you have an email domain)

1. In Telegram, open **@BotFather** → `/newbot`. Name: `ConstantUnits`. Username: e.g. `ConstantUnitsBot` (must end in
   `bot`). BotFather gives you a **token**: treat it like a password.
2. Optional, in BotFather: `/setdescription`, `/setuserpic` (use `brand/out/avatar-400.png`).
3. **API** project in Pxxl, add:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `TELEGRAM_BOT_USERNAME` | the bot's username, without @ |
| `TELEGRAM_WEBHOOK_SECRET` | a new random string, letters and numbers only (`openssl rand -hex 32`) |
| `API_PUBLIC_URL` | `https://constant.pxxlspace.cv` |

4. **Worker** project: add `TELEGRAM_BOT_TOKEN` (the same token).
5. Redeploy both. The API's log shows `telegram webhook set`.
6. In the app: Account → Where tokens and receipts go → **Connect** → **Open Telegram** → Start. The bot replies
   "Connected". Send `STOP` and `START` to try them.

## 7. Check it works

- `https://<your-api>/health` → `{"ok":true}`.
- Sign in on the website, open Money, create your account number (Paystack test mode gives a test account).
- Add a DStv bill with a VTpass sandbox smartcard (`1212121212`): the lookup shows a name.
- In the worker's log you'll see the renewal scan every 5 minutes, and each order as it's paid in the sandbox.

## Watch for

- **Does the worker sleep?** Pxxl doesn't say whether free services idle. Check the worker's `/health` after an
  hour with no traffic. If it answers slowly the first time, it was asleep: renewals would be late. Fine for testing;
  not for customers.
- **Memory.** If a service restarts in a loop, open **Monitoring**; the free allocation may be too small.
- **Moving on.** All data is in Postgres. To move host, back the database up (`pg_dump` from the Connection URL)
  and restore it on the new one; keep the same `REF_ENCRYPTION_KEY` and `REF_HMAC_KEY`.
