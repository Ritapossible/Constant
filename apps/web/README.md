# Constant web

The landing page (`/`) and the Constant app (`/app`), one Next.js project.

- **`/`**: landing page. Black and white, Lenis smooth scroll, scroll reveals, scroll-pinned stepper, Motion animations.
- **`/app`**: sign in with Google, email, phone (SMS), passkey or wallet through Privy. Each person also gets a self-custodial embedded wallet for stablecoins. Inside:
  - **Home:** monthly total, heads-up reminders, covered-until list.
  - **Bills:** add data, airtime, electricity, cable TV or a subscription; log readings; pause; remove.
  - **Money:** your own address with QR, and live USDC/USDT balances on Base and USDC on Arc.
  - **Account:** sign-in methods, delivery channels, export or delete data.

  Forecasts, confidence wording and reminders come from `packages/rules`, the same engine the backend will use. During the preview, bills are saved on the user's device. Paying bills switches on with the licensed partner.
- **`/privacy`**: privacy notice.

```sh
pnpm --filter @constant/web dev     # http://localhost:3000 (builds packages/rules first)
pnpm --filter @constant/web build
```

## Deploy on Vercel

1. Root Directory: `apps/web`. Framework: Next.js. pnpm is detected from the lockfile.
2. Create a Privy app at dashboard.privy.io:
   - Login methods: enable **Google, Email, SMS, Passkey, Wallet**.
   - Embedded wallets: Ethereum on.
   - Allowed origins: your Vercel URL (and custom domain later).
3. Environment variables (see `.env.example`): `NEXT_PUBLIC_PRIVY_APP_ID` is required for `/app`. Optional: `NEXT_PUBLIC_BASE_RPC_URL`, `NEXT_PUBLIC_ARC_RPC_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL`.
