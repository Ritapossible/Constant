# partners

Interfaces in `src/types.ts`, each with a fake for tests and local dev:

| Interface | Real adapter | Notes |
|---|---|---|
| `CableVending` | `Vtpass` | GET with api-key + public-key, POST with api-key + secret-key. Request ids start with Lagos YYYYMMDDHHII. Anything unclear is "pending": requery, never pay again. Webhooks are unsigned hints. |
| `Funding` | `Paystack` | Dedicated account per user. `charge.success` with channel `dedicated_nuban`, HMAC-SHA512 in `x-paystack-signature`. |
| `Messaging` | `HttpMessaging` | Resend (email), Termii (SMS). |
| `Identity` | `Privy` | ES256 access tokens, issuer `privy.io`, audience = app id. Contact details from Privy's API, server-side. |
