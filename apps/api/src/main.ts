import { Secrets, createPool, keysFromEnv, migrate } from "@constant/db";
import { FakeCableVending, FakeFunding, FakeIdentity, Paystack, Privy, Vtpass } from "@constant/partners";
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
await migrate(db, (m) => console.log(JSON.stringify({ msg: m })));

const app = await buildApp({
  db,
  identity: fake ? new FakeIdentity() : new Privy({ appId: need("PRIVY_APP_ID"), appSecret: need("PRIVY_APP_SECRET"), verificationKey: need("PRIVY_VERIFICATION_KEY") }),
  vending: fake
    ? FakeCableVending.withDemoDecoders()
    : new Vtpass({ baseUrl: need("VTPASS_BASE_URL"), apiKey: need("VTPASS_API_KEY"), publicKey: need("VTPASS_PUBLIC_KEY"), secretKey: need("VTPASS_SECRET_KEY") }),
  funding: fake ? new FakeFunding() : new Paystack({ secretKey: need("PAYSTACK_SECRET_KEY"), preferredBank: env.PAYSTACK_PREFERRED_BANK ?? "wema-bank" }),
  secrets: new Secrets(keysFromEnv(env)),
  webOrigins: need("WEB_ORIGINS").split(",").map((s) => s.trim()),
  vtpassWebhookToken: need("VTPASS_WEBHOOK_TOKEN"),
  fundingEmailDomain: env.FUNDING_EMAIL_DOMAIN ?? "users.constant.ng",
});

const port = Number(env.PORT ?? 8080);
await app.listen({ port, host: "0.0.0.0" });
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    app.close().then(() => db.end()).finally(() => process.exit(0));
  });
}
