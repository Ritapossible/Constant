import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Encryption for payees (smartcard, meter, phone numbers we pay) and tokens. AES-256-GCM with a key id
 * on every ciphertext so keys can rotate (ARCHITECTURE "Security"). HMAC for lookups: an 10–13 digit
 * number is brute-forced in seconds from a plain hash (D-012).
 */
export interface SecretKeys {
  /** Key id → 32-byte key. The first entry encrypts; all of them decrypt. */
  encryption: { id: string; key: Buffer }[];
  hmac: Buffer;
}

export function keysFromEnv(env: NodeJS.ProcessEnv = process.env): SecretKeys {
  const enc = env.REF_ENCRYPTION_KEY;
  const mac = env.REF_HMAC_KEY;
  if (!enc || !mac) throw new Error("REF_ENCRYPTION_KEY and REF_HMAC_KEY must be set (openssl rand -base64 32)");
  const keys = [{ id: env.REF_ENCRYPTION_KEY_ID ?? "k1", key: decode32(enc, "REF_ENCRYPTION_KEY") }];
  if (env.REF_ENCRYPTION_KEY_OLD) keys.push({ id: env.REF_ENCRYPTION_KEY_OLD_ID ?? "k0", key: decode32(env.REF_ENCRYPTION_KEY_OLD, "REF_ENCRYPTION_KEY_OLD") });
  return { encryption: keys, hmac: decode32(mac, "REF_HMAC_KEY") };
}

function decode32(b64: string, name: string): Buffer {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64`);
  return k;
}

export class Secrets {
  constructor(private readonly keys: SecretKeys) {
    if (keys.encryption.length === 0) throw new Error("Secrets: no encryption key");
  }

  encrypt(plain: string): string {
    const { id, key } = this.keys.encryption[0]!;
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return [id, iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
  }

  decrypt(sealed: string): string {
    const [id, iv, tag, ct] = sealed.split(".");
    const k = this.keys.encryption.find((e) => e.id === id);
    if (!k || !iv || !tag || !ct) throw new Error("Secrets: unknown key or malformed ciphertext");
    const d = createDecipheriv("aes-256-gcm", k.key, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  }

  hmac(value: string): string {
    return createHmac("sha256", this.keys.hmac).update(value).digest("hex");
  }
}

/** Unguessable public id, base62, from 16 random bytes. */
export function receiptId(): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let n = BigInt("0x" + randomBytes(16).toString("hex"));
  let out = "";
  while (n > 0n) {
    out = alphabet[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(22, "0");
}
