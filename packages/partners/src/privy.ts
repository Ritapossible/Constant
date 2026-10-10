/**
 * Privy (D-056). Access tokens are ES256 JWTs: issuer "privy.io", audience = app id, user DID in `sub`.
 * The verification key is copied from the Privy dashboard (App settings) into PRIVY_VERIFICATION_KEY.
 * Contact details come from Privy's REST API with the app secret, server-side only.
 */
import { importSPKI, jwtVerify, type CryptoKey } from "jose";
import { fetchJson, type Fetch } from "./http.js";
import type { Identity, IdentityUser } from "./types.js";

export interface PrivyConfig {
  appId: string;
  appSecret: string;
  verificationKey: string;
  fetch?: Fetch;
}

export class Privy implements Identity {
  private key: Promise<CryptoKey> | null = null;
  private readonly f: Fetch;

  constructor(private readonly c: PrivyConfig) {
    this.f = c.fetch ?? fetch;
  }

  async verify(accessToken: string): Promise<string | null> {
    try {
      this.key ??= importSPKI(this.c.verificationKey.replace(/\\n/g, "\n"), "ES256");
      const { payload } = await jwtVerify(accessToken, await this.key, { issuer: "privy.io", audience: this.c.appId, algorithms: ["ES256"] });
      return typeof payload.sub === "string" && payload.sub.startsWith("did:privy:") ? payload.sub : null;
    } catch {
      return null;
    }
  }

  async user(did: string): Promise<IdentityUser> {
    const res = await fetchJson(this.f, `https://api.privy.io/v1/users/${encodeURIComponent(did)}`, {
      method: "GET",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.c.appId}:${this.c.appSecret}`).toString("base64")}`,
        "privy-app-id": this.c.appId,
      },
      timeoutMs: 10_000,
    });
    if (res.status !== 200) throw new Error(`privy user lookup failed (${res.status})`);
    return contactFromPrivyUser(did, res.body);
  }
}

/** Picks the verified email and phone from a Privy user object. Exported for tests. */
export function contactFromPrivyUser(did: string, body: unknown): IdentityUser {
  const accounts = ((body as { linked_accounts?: unknown[] })?.linked_accounts ?? []) as Record<string, unknown>[];
  const email =
    (accounts.find((a) => a.type === "email")?.address as string | undefined) ??
    (accounts.find((a) => a.type === "google_oauth")?.email as string | undefined) ??
    null;
  const phoneAcct = accounts.find((a) => a.type === "phone");
  const raw = (phoneAcct?.phoneNumber ?? phoneAcct?.number) as string | undefined;
  const digits = raw?.replace(/[^\d+]/g, "") ?? "";
  const phoneE164 = digits ? (digits.startsWith("+") ? digits : `+${digits}`) : null;
  const wallets = accounts
    .filter((a) => a.type === "wallet" && a.chain_type === "ethereum" && typeof a.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(a.address as string))
    .map((a) => ({ address: a.address as string, kind: (a.wallet_client_type === "privy" || a.connector_type === "embedded" ? "embedded" : "external") as "embedded" | "external" }));
  return { did, email, phoneE164, wallets };
}

/** Tests and local dev: a token is "fake:<did>". */
export class FakeIdentity implements Identity {
  users = new Map<string, IdentityUser>();
  async verify(accessToken: string): Promise<string | null> {
    return accessToken.startsWith("fake:did:privy:") ? accessToken.slice(5) : null;
  }
  async user(did: string): Promise<IdentityUser> {
    return this.users.get(did) ?? { did, email: `${did.slice(10)}@example.com`, phoneE164: null, wallets: [] };
  }
}
