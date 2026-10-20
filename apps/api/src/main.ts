import { Secrets, createPool, keysFromEnv, migrate } from "@constant/db";
import { BasePermissionVerifier, EvmPermissionVerifier, evmAddress } from "@constant/chains";
import { FakeCableVending, FakeFunding, FakeIdentity, PaycrestRates, PaycrestSender, Paystack, Privy, Telegram, Vtpass } from "@constant/partners";
import { buildApp } from "./app.js";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

const env = process.env;
const fake = env.PARTNERS === "fake";
if (fake && env.NODE_ENV === "production") throw new Error("PARTNERS=fake is not allowed in production");

const db = createPool(need("DATABASE_URL"));

// Telegram (D-082): on when all three are set. The webhook is (re)registered at start when API_PUBLIC_URL is set.
const telegram =
  env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME && env.TELEGRAM_WEBHOOK_SECRET
    ? { client: new Telegram({ botToken: env.TELEGRAM_BOT_TOKEN }), botUsername: env.TELEGRAM_BOT_USERNAME.replace(/^@/, ""), webhookSecret: env.TELEGRAM_WEBHOOK_SECRET }
    : undefined;
await migrate(db, (m) => console.log(JSON.stringify({ msg: m })));

const app = await buildApp({
  db,
  identity: fake ? new FakeIdentity() : new Privy({ appId: need("PRIVY_APP_ID"), appSecret: need("PRIVY_APP_SECRET"), verificationKey: need("PRIVY_VERIFICATION_KEY") }),
  vending: fake
    ? FakeCableVending.withDemoDecoders()
    : new Vtpass({ baseUrl: need("VTPASS_BASE_URL"), apiKey: need("VTPASS_API_KEY"), publicKey: need("VTPASS_PUBLIC_KEY"), secretKey: need("VTPASS_SECRET_KEY") }),
  ...(() => {
    const paystack = fake ? new FakeFunding() : new Paystack({ secretKey: need("PAYSTACK_SECRET_KEY"), preferredBank: env.PAYSTACK_PREFERRED_BANK ?? "wema-bank" });
    // Withdrawals use the same Paystack account; still off until payouts_enabled is switched on (D-050).
    // Card, USSD and QR top-ups (D-075) too, when CARD_TOPUPS=true; Paystack sends the user back to the app.
    const web = need("WEB_ORIGINS").split(",")[0]!.trim();
    return {
      funding: paystack,
      payouts: paystack,
      ...(env.CARD_TOPUPS === "true" ? { checkout: { provider: paystack, callbackUrl: env.TOPUP_CALLBACK_URL ?? `${web}/app` } } : {}),
    };
  })(),
  secrets: new Secrets(keysFromEnv(env)),
  webOrigins: need("WEB_ORIGINS").split(",").map((s) => s.trim()),
  vtpassWebhookToken: need("VTPASS_WEBHOOK_TOKEN"),
  ...(telegram ? { telegram } : {}),
  // Sign-in sessions (D-080): defaults 7 days unused, 30 days in all.
  sessions: { idleDays: Number(env.SESSION_IDLE_DAYS ?? 7), maxDays: Number(env.SESSION_MAX_DAYS ?? 30) },
  fundingEmailDomain: env.FUNDING_EMAIL_DOMAIN ?? "users.constant.ng",
  ...(env.OPS_TOKEN ? { opsToken: env.OPS_TOKEN } : {}),
  ...(env.PAYCREST_API_KEY && env.PAYCREST_API_SECRET ? { offramp: new PaycrestSender(env.PAYCREST_API_KEY, env.PAYCREST_API_SECRET) } : {}),
  // Dollar autopay (D-063): on when the spender's address is set. The API never holds the spender's key.
  ...(env.SPENDER_ADDRESS
    ? (() => {
        const spender = evmAddress(env.SPENDER_ADDRESS) ?? (() => { throw new Error("SPENDER_ADDRESS is not an address"); })();
        return {
          dollars: {
            chain: new BasePermissionVerifier(spender, env.BASE_RPC_URL),
            // USDC on Arc (D-070): same spender address, signatures checked on Arc. Same switch as the worker.
            ...(env.ARC_AUTOPAY === "true" ? { arc: new EvmPermissionVerifier("arc", spender, env.ARC_RPC_URL) } : {}),
            rates: new PaycrestRates(env.PAYCREST_BASE_URL ?? "https://api.paycrest.io"),
          },
        };
      })()
    : {}),
});

const port = Number(env.PORT ?? 8080);
await app.listen({ port, host: "0.0.0.0" });
if (telegram && env.API_PUBLIC_URL) {
  await telegram.client
    .setWebhook(`${env.API_PUBLIC_URL.replace(/\/$/, "")}/webhooks/telegram`, telegram.webhookSecret)
    .then(() => console.log(JSON.stringify({ msg: "telegram webhook set" })))
    .catch((err: Error) => console.error(JSON.stringify({ msg: "telegram webhook not set", err: err.message })));
}
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    app.close().then(() => db.end()).finally(() => process.exit(0));
  });
}
