import { BasePermissionChain, FakeAnchorer, StellarAnchorer, ViemReader, evmAddress, type Anchorer, type EvmReader } from "@constant/chains";
import { Secrets, createPool, keysFromEnv, type Db } from "@constant/db";
import { CircleScreener, FakeCableVending, FakeMessaging, HttpMessaging, PaycrestRates, Vtpass, type CableVending, type Messaging } from "@constant/partners";
import type { Hex } from "viem";
import type { DollarDeps } from "./dollars.js";

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
  return { db, vending, messaging, secrets: new Secrets(keysFromEnv(env)), fallbackPhone: need(env, "VEND_FALLBACK_PHONE") };
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
