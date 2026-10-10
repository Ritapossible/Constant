import { Secrets, createPool, keysFromEnv, type Db } from "@constant/db";
import { FakeCableVending, FakeMessaging, HttpMessaging, Vtpass, type CableVending, type Messaging } from "@constant/partners";

function need(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Builds the real dependencies from the environment. Fakes only when explicitly asked for. */
export function fromEnv(env: NodeJS.ProcessEnv = process.env): { db: Db; vending: CableVending; messaging: Messaging; secrets: Secrets; fallbackPhone: string } {
  const db = createPool(need(env, "DATABASE_URL"));
  const vending: CableVending =
    env.VENDING_PROVIDER === "vtpass"
      ? new Vtpass({ baseUrl: need(env, "VTPASS_BASE_URL"), apiKey: need(env, "VTPASS_API_KEY"), publicKey: need(env, "VTPASS_PUBLIC_KEY"), secretKey: need(env, "VTPASS_SECRET_KEY") })
      : env.VENDING_PROVIDER === "fake"
        ? new FakeCableVending()
        : (() => {
            throw new Error("VENDING_PROVIDER must be vtpass or fake");
          })();
  const messaging: Messaging =
    env.MESSAGING_PROVIDER === "fake"
      ? new FakeMessaging()
      : new HttpMessaging({
          ...(env.RESEND_API_KEY ? { resend: { apiKey: env.RESEND_API_KEY, from: need(env, "EMAIL_FROM") } } : {}),
          ...(env.TERMII_API_KEY ? { termii: { apiKey: env.TERMII_API_KEY, senderId: env.TERMII_SENDER_ID ?? "Constant", ...(env.TERMII_BASE_URL ? { baseUrl: env.TERMII_BASE_URL } : {}) } } : {}),
        });
  return { db, vending, messaging, secrets: new Secrets(keysFromEnv(env)), fallbackPhone: need(env, "VEND_FALLBACK_PHONE") };
}
