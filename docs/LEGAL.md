# Launch compliance checklist (D-081)

Not legal advice: have a Nigerian lawyer review the three policies before payments open to the public.

## Pages

| Page | Where | Source |
|---|---|---|
| Privacy policy | `/privacy` | `apps/web/app/privacy/page.tsx`; the services table comes from `apps/web/lib/legal.ts` |
| Terms of service | `/terms` | `apps/web/app/terms/page.tsx` |
| Refund policy | `/refunds`, and linked beside every payment: card top-up, adding a bill, adding cable | `apps/web/app/refunds/page.tsx` |

All three are in the footer, the sitemap, and on the sign-in screen ("By continuing you agree to our terms and privacy policy").
Change `LEGAL_UPDATED` in `lib/legal.ts` whenever a page's meaning changes, and tell users before a change that matters applies.

## Third-party services that receive personal data

Kept in `apps/web/lib/legal.ts` (`SERVICES`) and shown on the privacy page. When a service is added or removed in code,
update that list in the same commit.

| Service | Data | Used by |
|---|---|---|
| Privy | Sign-in email / Google / wallet, wallet addresses, device details | web, api |
| Paystack | Name, email, phone, amounts, payout bank account (cards stay with Paystack) | api, worker |
| VTpass | Phone, meter and smartcard numbers, amounts, a contact phone | api, worker |
| Resend | Email address, message | worker |
| Telegram | Chat ID, messages with the bot (only if the person connects it) | api, worker |
| Termii | Phone number, message | worker |
| Circle | Wallet addresses (sanctions screening) | worker |
| Vercel, Pxxl, Neon | Hosting and database; IP and browser in logs | all |
| Base, Arc (public node) | Wallet address and transactions (public on chain) | web, worker |
| Paycrest, Stellar | No personal data: Paycrest sells ConstantUnits's own stablecoins; Stellar holds receipt fingerprints only | worker |

Not used: analytics, advertising, session replay, tracking cookies. **If one is ever added, a cookie consent banner and
a privacy policy update are needed first** (EU/UK visitors).

## Cookies

Only storage the app needs to work: Privy's sign-in session, the last-activity time (sign-out after 7 days, D-080), the
sign-out reason, and preview bills waiting to move to the account. These are strictly necessary, so no consent banner
is required. The privacy page says so.

## Deleting an account

Account, then Close account (`DELETE /v1/me`, D-081). Refused while naira is left, a payment, withdrawal or recent
top-up is moving, or (in the app) stablecoins are in the ConstantUnits wallet. Erases contact details, bill numbers,
readings, bank and wallet details, sessions, and the Privy user (with its embedded wallet); keeps ledger, orders and
funding events without them for at least five years. A transfer to the old account number is held for a person
(`funding_unmatched`), and an ops alert asks for the Paystack dedicated account to be deactivated.

## Keys and where they live

**Browser (public by design, safe to see):** `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_SPENDER_ADDRESS` (an address, not a key), `NEXT_PUBLIC_*_RPC_URL`,
`NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_LEGAL_ADDRESS`, and on/off switches. Never put a key in a `NEXT_PUBLIC_` variable:
use a public RPC URL there, or one with a key restricted to the site's domain.

**Server only (API and worker env, never in the repo, never in Vercel):** `DATABASE_URL`, `REF_ENCRYPTION_KEY`,
`REF_HMAC_KEY`, `PRIVY_APP_SECRET`, `PAYSTACK_SECRET_KEY`, `VTPASS_API_KEY`, `VTPASS_SECRET_KEY`, `VTPASS_PUBLIC_KEY`,
`VTPASS_WEBHOOK_TOKEN`, `RESEND_API_KEY`, `TERMII_API_KEY`, `CIRCLE_API_KEY`, `PAYCREST_API_KEY`, `PAYCREST_API_SECRET`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPS_TOKEN`, `SPENDER_PRIVATE_KEY`, `STELLAR_SECRET`, `QIE_DEPLOYER_KEY`. Full list with where each comes from: ENV.md.

**Audit (2026-10-20):** the live site's JavaScript contains no secret keys; the repository and its history contain none
(`scripts/guard.sh` checks every CI run). GitGuardian's alert on commit cbc0590 was a made-up electricity token in a
test, not a credential.

## Still to do before public launch

- Register the business (CAC) and set `NEXT_PUBLIC_LEGAL_NAME` and `NEXT_PUBLIC_LEGAL_ADDRESS`: the policies then name
  who is responsible and where to send post.
- A contact address on the company's own domain (for example privacy@ and support@) instead of Gmail.
- Lawyer review of the three policies; confirm the refund and return-of-funds wording with Paystack (D-050).
- Register with the Nigeria Data Protection Commission if ConstantUnits becomes a data controller "of major importance".
