import { BasePermissionChain, CctpBridge, EvmPermissionChain, FakeAnchorer, StellarAnchorer, StellarRail, ViemReader, evmAddress, isStellarAccount, type Anchorer, type EvmReader } from "@constant/chains";
import { Secrets, createPool, keysFromEnv, type Db } from "@constant/db";
import { CircleScreener, FakeCableVending, FakeMessaging, HttpMessaging, PaycrestRates, PaycrestSender, Paystack, Telegram, Vtpass, withTelegram, type CableVending, type Messaging, type Payouts } from "@constant/partners";
import type { OfframpDeps } from "./offramp.js";
import type { Hex } from "viem";
import type { DollarDeps } from "./dollars.js";

function need(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Builds the real dependencies from the environment. Fakes only when explicitly asked for. */
export function fromEnv(env: NodeJS.ProcessEnv = process.env): { db: Db; vending: CableVending; messaging: Messaging; secrets: Secrets; fallbackPhone: string; payouts?: Payouts; appUrl?: string } {
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
          ...(env.RESEND_API_KEY ? { resend: { apiKey: env.RESEND_API_KEY, from: need(env, "EMAIL_FROM"), ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}) } } : {}),
          ...(env.TERMII_API_KEY ? { termii: { apiKey: env.TERMII_API_KEY, senderId: env.TERMII_SENDER_ID ?? "ConstUnits", ...(env.TERMII_BASE_URL ? { baseUrl: env.TERMII_BASE_URL } : {}) } } : {}),
        });
  // Telegram (D-082) works alongside real or fake email and SMS, so it can be used before an email domain exists.
  const messagingWithTelegram = env.TELEGRAM_BOT_TOKEN ? withTelegram(messaging, new Telegram({ botToken: env.TELEGRAM_BOT_TOKEN })) : messaging;
  // Withdrawals go out through Paystack transfers when its key is set (still gated by payouts_enabled).
  const payouts = env.PAYSTACK_SECRET_KEY ? new Paystack({ secretKey: env.PAYSTACK_SECRET_KEY, preferredBank: env.PAYSTACK_PREFERRED_BANK ?? "wema-bank" }) : undefined;
  return { db, vending, messaging: messagingWithTelegram, secrets: new Secrets(keysFromEnv(env)), fallbackPhone: need(env, "VEND_FALLBACK_PHONE"), ...(payouts ? { payouts } : {}), ...(env.APP_URL ? { appUrl: env.APP_URL } : {}) };
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
 * USDC on Stellar (D-085): on when STELLAR_AUTOPAY=true. STELLAR_OPERATOR_SECRET is the mandate contract's admin and
 * pays every fee and sponsored reserve, so it holds XLM; charged USDC goes to the treasury account set in the
 * contract. A different key from STELLAR_SECRET (receipt anchoring), so the two never race for a sequence number.
 */
export function stellarFromEnv(env: NodeJS.ProcessEnv = process.env): { rail: StellarRail } | undefined {
  if (env.STELLAR_AUTOPAY !== "true") return undefined;
  const network = env.STELLAR_NETWORK === "public" ? "public" : "testnet";
  const contractId = env.STELLAR_MANDATE_CONTRACT ?? "";
  if (!/^C[A-Z2-7]{55}$/.test(contractId)) throw new Error("STELLAR_MANDATE_CONTRACT must be the mandate contract's C… address");
  const secret = env.STELLAR_OPERATOR_SECRET ?? "";
  if (!/^S[A-Z2-7]{55}$/.test(secret)) throw new Error("STELLAR_OPERATOR_SECRET must be a Stellar secret key (S…)");
  if (env.STELLAR_SECRET && env.STELLAR_SECRET === secret) throw new Error("STELLAR_OPERATOR_SECRET must differ from STELLAR_SECRET (receipt anchoring)");
  if (network === "public" && !env.STELLAR_RPC_URL) throw new Error("STELLAR_RPC_URL is required on the public network");
  const usdc = env.STELLAR_USDC_ISSUER ? { code: "USDC", issuer: env.STELLAR_USDC_ISSUER } : undefined;
  if (usdc && !isStellarAccount(usdc.issuer)) throw new Error("STELLAR_USDC_ISSUER must be a G… account");
  return {
    rail: new StellarRail({
      network,
      contractId,
      operatorSecret: secret,
      ...(env.STELLAR_RPC_URL ? { rpcUrl: env.STELLAR_RPC_URL } : {}),
      ...(usdc ? { usdc } : {}),
    }),
  };
}

/**
 * Dollar autopay. Base (D-063) is on when SPENDER_PRIVATE_KEY is set: that key is Constant's spender, it receives
 * charged USDC and pays Base gas, so it should hold a little ETH and be swept to treasury. Stellar (D-085) is on
 * when STELLAR_AUTOPAY=true, with or without Base.
 */
export function dollarsFromEnv(env: NodeJS.ProcessEnv = process.env): DollarDeps | undefined {
  const key = env.SPENDER_PRIVATE_KEY;
  const stellar = stellarFromEnv(env);
  if (!key && !stellar) return undefined;
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("SPENDER_PRIVATE_KEY must be 0x + 64 hex characters");
  const treasury = env.TREASURY_ADDRESS ? evmAddress(env.TREASURY_ADDRESS) : null;
  if (env.TREASURY_ADDRESS && !treasury) throw new Error("TREASURY_ADDRESS is not an address");
  const production = env.NODE_ENV === "production";
  if (key && production && !treasury) throw new Error("TREASURY_ADDRESS is required in production: charged USDC must not sit on the hot key");
  const dollars = (v: string | undefined, fallback: string) => BigInt(Math.round(Number(v ?? fallback) * 100)) * 10_000n; // "$500" → micro
  return {
    ...(key ? { chain: new BasePermissionChain(key as Hex, env.BASE_RPC_URL) } : {}),
    ...(stellar ? { stellar } : {}),
    rates: new PaycrestRates(env.PAYCREST_BASE_URL ?? "https://api.paycrest.io"),
    confirmations: BigInt(env.BASE_CONFIRMATIONS ?? "5"),
    ...(env.CIRCLE_API_KEY ? { screener: new CircleScreener(env.CIRCLE_API_KEY, env.CIRCLE_SCREENING_CHAIN ?? "ETH") } : {}),
    screeningRequired: production || env.SCREENING_REQUIRED === "true",
    dailyLimitMicro: dollars(env.DOLLAR_DAILY_LIMIT_USD, "500"),
    floatMarginMinor: BigInt(Math.round(Number(env.FLOAT_MARGIN_NGN ?? "50000") * 100)),
    ...(treasury ? { treasury } : {}),
    sweepMinMicro: dollars(env.SWEEP_MIN_USD, "50"),
    // USDC on Arc (D-070): on only after Coinbase's manager is deployed there (scripts/arc/deploy-spend-permissions.mjs).
    ...(key && env.ARC_AUTOPAY === "true"
      ? {
          arc: {
            chain: new EvmPermissionChain("arc", key as Hex, env.ARC_RPC_URL),
            bridge: new CctpBridge("arc", "base", key as Hex, { arc: env.ARC_RPC_URL, base: env.BASE_RPC_URL }),
            confirmations: 1n,
            bridgeMinMicro: dollars(env.ARC_BRIDGE_MIN_USD, "20"),
            bridgeMaxFeeBps: BigInt(env.ARC_BRIDGE_MAX_FEE_BPS ?? "10"),
          },
        }
      : {}),
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
    recipient: { institution: need2("FLOAT_ACCOUNT_INSTITUTION"), accountIdentifier: need2("FLOAT_ACCOUNT_NUMBER"), accountName: need2("FLOAT_ACCOUNT_NAME"), memo: "ConstantUnits float" },
    lowWaterMinor: naira(env.FLOAT_LOW_NGN ?? "200000"),
    targetMinor: naira(env.FLOAT_TARGET_NGN ?? "1000000"),
    minOrderMicro: BigInt(Math.round(Number(env.OFFRAMP_MIN_USD ?? "20") * 100)) * 10_000n,
  };
}
