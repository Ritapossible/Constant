# Constant web

The landing page (`/`) and the Constant app (`/app`), one Next.js project.

- **`/`**: landing page. Black and white, Lenis smooth scroll, scroll reveals, scroll-pinned stepper, Motion animations.
- **`/app`**: sign in with Google, email, phone (SMS), passkey or wallet through Privy. Each person also gets a self-custodial embedded wallet for stablecoins. Inside:
  - **Home:** monthly total, heads-up reminders, covered-until list.
  - **Bills:** add data, airtime, electricity, cable TV or a subscription; log readings; pause; remove.
  - **Money:** your own address with QR, and live USDC/USDT balances on Base and USDC on Arc.
  - **Account:** sign-in methods, your wallet (copy address; export the private key in Privy's secure window, after a clear warning), delivery channels, download or delete data.

  Product details: bills can be added, edited, paused and removed (with Undo); a first-run checklist guides new users; the open tab is kept in the URL; if the embedded wallet is missing it is created again, with a retry if that fails.

  Accessibility: dialogs trap and restore focus and close on Escape; form errors are linked to their fields and focus moves to the first one; confirmations are announced; touch targets are at least 44px; reduced motion is respected. Checked with axe-core (no violations).

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
