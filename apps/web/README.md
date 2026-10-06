# Constant website

Next.js landing page with early-access sign-up. Black and white, Lenis smooth scroll, scroll reveals, a scroll-pinned "How it works" stepper and Motion animations. Respects reduced motion.

```sh
pnpm --filter @constant/web dev     # http://localhost:3000
pnpm --filter @constant/web build
```

## Deploy on Vercel

1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `apps/web`. Framework: Next.js (auto-detected). pnpm is detected from the lockfile.
3. Add environment variables (see `.env.example`). Sign-ups are only saved when one destination is set:
   - `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`: each sign-up arrives in your Telegram, or
   - `WAITLIST_WEBHOOK_URL`: any JSON webhook (Slack, Discord, Zapier, Google Apps Script).
4. Optional: `NEXT_PUBLIC_SITE_URL` for social preview links.
