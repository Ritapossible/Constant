import { BasePermissionChain, FakeAnchorer, StellarAnchorer, ViemReader, evmAddress, type Anchorer, type EvmReader } from "@constant/chains";
import { Secrets, createPool, keysFromEnv, type Db } from "@constant/db";
import { CircleScreener, FakeCableVending, FakeMessaging, HttpMessaging, PaycrestRates, PaycrestSender, Paystack, Vtpass, type CableVending, type Messaging, type Payouts } from "@constant/partners";
import type { OfframpDeps } from "./offramp.js";
import type { Hex } from "viem";
import type { DollarDeps } from "./dollars.js";

function need(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Builds the real dependencies from the environment. Fakes only when explicitly asked for. */
export function fromEnv(env: NodeJS.ProcessEnv = process.env): { db: Db; vending: CableVending; messaging: Messaging; secrets: Secrets; fallbackPhone: string; payouts?: Payouts } {
  const db = createPool(need(env, "DATABASE_URL"));
  const vending: CableVending =
    env.VENDING_PROVIDER === "vtpass"
      ? new Vtpass({ baseUrl: need(env, "VTPASS_BASE_URL"), apiKey: need(env, "VTPASS_API_KEY"), publicKey: need(env, "VTPASS_PUBLIC_KEY"), secretKey: need(env, "VTPASS_SECRET_KEY") })
      : env.VENDING_PROVIDER === "fake"
        ? FakeCableVending.withDemoDecoders()
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
  // Withdrawals go out through Paystack transfers when its key is set (still gated by payouts_enabled).
  const payouts = env.PAYSTACK_SECRET_KEY ? new Paystack({ secretKey: env.PAYSTACK_SECRET_KEY, preferredBank: env.PAYSTACK_PREFERRED_BANK ?? "wema-bank" }) : undefined;
  return { db, vending, messaging, secrets: new Secrets(keysFromEnv(env)), fallbackPhone: need(env, "VEND_FALLBACK_PHONE"), ...(payouts ? { payouts } : {}) };
}

/**
 * Chain jobs are opt-in per environment: CHAINS=base,arc turns on deposit indexing for those chains,
 * STELLAR_SECRET turns on receipt anchoring (STELLAR_NETWORK=testnet until the account is funded on public).
 */
export function chainsFromEnv(env: NodeJS.ProcessEnv = process.env): { readers: EvmReader[]; anchorer: Anchorer | null; scanAllTokens: boolean } {
  const wanted = (env.CHAINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const readers = wanted.map((c) => {
    if (c === "base") return new ViemReader("base", env.BASE_RPC_URL);
    if (c === "arc") return new ViemReader("arc", env.ARC_RPC_URL);
    throw new Error(`CHAINS: unknown chain ${c}`);
  });
  const network = env.STELLAR_NETWORK === "public" ? "public" : "testnet";
  const anchorer = env.STELLAR_SECRET === "fake" ? new FakeAnchorer() : env.STELLAR_SECRET ? new StellarAnchorer(network, env.STELLAR_SECRET) : null;
  return { readers, anchorer, scanAllTokens: env.DEPOSITS_ALL_TOKENS === "true" };
}

/**
 * Dollar autopay on Base (D-063): on only when SPENDER_PRIVATE_KEY is set. That key is Constant's spender:
 * it receives charged USDC and pays Base gas, so it should hold a little ETH and be swept to treasury.
 */
export function dollarsFromEnv(env: NodeJS.ProcessEnv = process.env): DollarDeps | undefined {
  const key = env.SPENDER_PRIVATE_KEY;
  if (!key) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("SPENDER_PRIVATE_KEY must be 0x + 64 hex characters");
  const treasury = env.TREASURY_ADDRESS ? evmAddress(env.TREASURY_ADDRESS) : null;
  if (env.TREASURY_ADDRESS && !treasury) throw new Error("TREASURY_ADDRESS is not an address");
  const production = env.NODE_ENV === "production";
  if (production && !treasury) throw new Error("TREASURY_ADDRESS is required in production: charged USDC must not sit on the hot key");
  const dollars = (v: string | undefined, fallback: string) => BigInt(Math.round(Number(v ?? fallback) * 100)) * 10_000n; // "$500" → micro
  return {
    chain: new BasePermissionChain(key as Hex, env.BASE_RPC_URL),
    rates: new PaycrestRates(env.PAYCREST_BASE_URL ?? "https://api.paycrest.io"),
    confirmations: BigInt(env.BASE_CONFIRMATIONS ?? "5"),
    ...(env.CIRCLE_API_KEY ? { screener: new CircleScreener(env.CIRCLE_API_KEY, env.CIRCLE_SCREENING_CHAIN ?? "ETH") } : {}),
    screeningRequired: production || env.SCREENING_REQUIRED === "true",
    dailyLimitMicro: dollars(env.DOLLAR_DAILY_LIMIT_USD, "500"),
    floatMarginMinor: BigInt(Math.round(Number(env.FLOAT_MARGIN_NGN ?? "50000") * 100)),
    ...(treasury ? { treasury } : {}),
    sweepMinMicro: dollars(env.SWEEP_MIN_USD, "50"),
  };
}

/**
 * Off-ramp (D-068): on when PAYCREST_API_KEY and the vend partner's funding account are set. Charged USDC is sold
 * into that account when the float drops below FLOAT_LOW_NGN, up to FLOAT_TARGET_NGN.
 */
export function offrampFromEnv(env: NodeJS.ProcessEnv = process.env): OfframpDeps | undefined {
  if (!env.PAYCREST_API_KEY) return undefined;
  const need2 = (n: string) => {
    const v = env[n];
    if (!v) throw new Error(`${n} is required for the off-ramp`);
    return v;
  };
  const naira = (v: string) => BigInt(Math.round(Number(v) * 100));
  return {
    offramp: new PaycrestSender(env.PAYCREST_API_KEY, need2("PAYCREST_API_SECRET"), env.PAYCREST_BASE_URL ?? "https://api.paycrest.io"),
    rates: new PaycrestRates(env.PAYCREST_BASE_URL ?? "https://api.paycrest.io"),
    recipient: { institution: need2("FLOAT_ACCOUNT_INSTITUTION"), accountIdentifier: need2("FLOAT_ACCOUNT_NUMBER"), accountName: need2("FLOAT_ACCOUNT_NAME"), memo: "Constant float" },
    lowWaterMinor: naira(env.FLOAT_LOW_NGN ?? "200000"),
    targetMinor: naira(env.FLOAT_TARGET_NGN ?? "1000000"),
    minOrderMicro: BigInt(Math.round(Number(env.OFFRAMP_MIN_USD ?? "20") * 100)) * 10_000n,
  };
}
