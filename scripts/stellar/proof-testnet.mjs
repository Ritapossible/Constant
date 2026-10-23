#!/usr/bin/env node
/**
 * The Stellar proof run (D-085), on Stellar testnet, with Constant's own chain code (packages/chains):
 *
 *   1. Constant's operator and treasury accounts (friendbot), the mandate contract deployed (contracts/mandate).
 *   2. A brand-new user key that never holds XLM: Constant sponsors its account and USDC trustline; the user only
 *      signs the transaction hash.
 *   3. The user receives Circle's testnet USDC (bought on the testnet exchange by the operator, standing in for a
 *      deposit from any wallet or exchange).
 *   4. The user signs one authorization for "up to 10 USDC every 30 days" for one bill; Constant submits it.
 *   5. Constant charges 4 USDC, then 6 USDC: both go straight to the treasury.
 *   6. The contract refuses: the same charge id twice, a charge over the cap, any charge after a revoke.
 *   7. The two charges' receipts go into a Merkle tree whose root is written to the ledger as a memo, and checked.
 *   8. The user's XLM balance is still zero: every fee and reserve was Constant's.
 *
 * Testnet only; it makes its own keys. Takes about two minutes.
 *
 *   pnpm --filter @constant/chains build
 *   node scripts/stellar/proof-testnet.mjs                 # add --record to write docs/proof/stellar-testnet.md
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const req = createRequire(path.join(root, "packages/chains/package.json"));
const S = await import(pathToFileURL(req.resolve("@stellar/stellar-sdk")).href);
const C = await import(pathToFileURL(path.join(root, "packages/chains/dist/index.js")).href);
const { Keypair, Operation, TransactionBuilder, Asset, Horizon } = S;

const NET = C.STELLAR.testnet;
const record = process.argv.includes("--record");
const WASM = readFileSync(path.join(root, "contracts/mandate/constant_mandate.wasm"));
const log = [];
let failed = false;
const say = (m) => {
  console.log(m);
  log.push(m);
};
const ok = (c, m) => {
  say(`${c ? "ok  " : "FAIL"} ${m}`);
  if (!c) failed = true;
};
const stop = (m) => {
  console.error(`STOP: ${m}`);
  process.exit(1);
};
const link = (h) => `${NET.explorer}/tx/${h}`;
const usd = (micro) => `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;
const hex = (b) => Buffer.from(b).toString("hex");
const signHex = (kp, payloadHex) => hex(kp.sign(Buffer.from(payloadHex, "hex")));
/** The contract error a prepare was refused with, or null if it went through. */
const refusal = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return /\((?:#\d+)\)/.test(e.message) ? e.message.replace(/^.*?: /, "") : e.message;
  }
};

async function friendbot(account) {
  const r = await fetch(`${NET.friendbot}?addr=${account}`);
  if (!r.ok && !(await r.text()).includes("createAccountAlreadyExist")) stop(`friendbot refused ${account}`);
}

// ── 1. Constant's side ──────────────────────────────────────────────────────────
const operator = Keypair.random();
const treasury = Keypair.random();
say(`# Stellar testnet proof, ${new Date().toISOString()}`);
say(`operator ${operator.publicKey()}`);
say(`treasury ${treasury.publicKey()}`);
await Promise.all([friendbot(operator.publicKey()), friendbot(treasury.publicKey())]);

const horizon = new Horizon.Server(NET.horizon);
const usdc = new Asset(C.STELLAR_USDC.testnet.code, C.STELLAR_USDC.testnet.issuer);
{
  // The treasury holds USDC: one trustline, its own fee.
  const acct = await horizon.loadAccount(treasury.publicKey());
  const tx = new TransactionBuilder(acct, { fee: "1000", networkPassphrase: NET.passphrase })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(60)
    .build();
  tx.sign(treasury);
  await horizon.submitTransaction(tx);
}

const dep = await C.deployMandateContract({ network: "testnet", operatorSecret: operator.secret(), treasury: treasury.publicKey(), wasm: WASM });
say(`contract ${dep.contractId} (wasm ${dep.wasmHash})`);
say(`  ${NET.explorer}/contract/${dep.contractId}`);
const rail = new C.StellarRail({ network: "testnet", contractId: dep.contractId, operatorSecret: operator.secret() });

// ── 2. A user with no XLM ──────────────────────────────────────────────────────
const user = Keypair.random();
say(`user ${user.publicKey()} (never funded with XLM)`);
const before = await rail.accountState(user.publicKey());
ok(!before.exists, "the user's account doesn't exist yet");
const onboarding = await rail.prepareOnboarding(user.publicKey());
const onboardHash = await rail.submitOnboarding(user.publicKey(), onboarding, signHex(user, onboarding.hash));
say(`  onboarding ${link(onboardHash)}`);
const after = await rail.accountState(user.publicKey());
ok(after.exists && after.trustline, "account and USDC trustline exist, every reserve sponsored by Constant");
ok(after.xlmStroops === 0n, `the user holds ${after.xlmStroops} XLM`);
ok((await rail.prepareOnboarding(user.publicKey())) === null, "onboarding again is a no-op");

// ── 3. USDC arrives ─────────────────────────────────────────────────────────────
{
  const acct = await horizon.loadAccount(operator.publicKey());
  const tx = new TransactionBuilder(acct, { fee: "1000", networkPassphrase: NET.passphrase })
    .addOperation(Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: "500", destination: user.publicKey(), destAsset: usdc, destAmount: "25", path: [] }))
    .setTimeout(60)
    .build();
  tx.sign(operator);
  const res = await horizon.submitTransaction(tx);
  say(`  25 USDC to the user ${link(res.hash)}`);
}
ok((await rail.balanceMicro(user.publicKey())) === 25_000_000n, "the user holds 25.00 Circle testnet USDC");

// ── 4. One signature for one bill ───────────────────────────────────────────────
const MONTH = 30 * 86_400;
const mandateId = hex(randomBytes(32));
const terms = { owner: user.publicKey(), id: mandateId, capMicro: 10_000_000n, periodSecs: MONTH, endAt: Math.floor(Date.now() / 1000) + 3 * MONTH };
const draft = await rail.draftMandate(terms);
const signedEntry = await rail.signDraft(draft, signHex(user, draft.payload));
ok((await refusal(() => rail.signDraft(draft, signHex(Keypair.random(), draft.payload)))) !== null, "a signature by any other key is refused");
const create = await rail.prepareCreate(draft.terms, signedEntry);
await rail.broadcast(create.raw);
ok((await rail.waitFor(create)) === "confirmed", `mandate created: up to 10.00 USDC every 30 days, 3 periods ${link(create.hash)}`);
const m = await rail.getMandate(mandateId);
ok(m?.owner === user.publicKey() && m.capMicro === 10_000_000n && !m.revoked, "on chain: owner, cap and period as signed");
ok((await rail.remaining(mandateId)) === 10_000_000n, "chargeable now: 10.00");

// ── 5. Charges ───────────────────────────────────────────────────────────────────
const charges = [];
for (const [n, micro] of [[1, 4_000_000n], [2, 6_000_000n]]) {
  const chargeId = hex(randomBytes(32));
  const p = await rail.prepareCharge(mandateId, chargeId, micro);
  await rail.broadcast(p.raw);
  ok((await rail.waitFor(p)) === "confirmed", `charge ${n}: ${usd(micro)} USDC ${link(p.hash)}`);
  charges.push({ chargeId, micro, hash: p.hash });
}
const treasuryUsdc = (await horizon.loadAccount(treasury.publicKey())).balances.find((b) => b.asset_code === "USDC")?.balance;
ok(treasuryUsdc === "10.0000000", `the treasury received ${treasuryUsdc} USDC`);
ok((await rail.balanceMicro(user.publicKey())) === 15_000_000n, "the user has 15.00 left");
ok((await rail.remaining(mandateId)) === 0n, "this period's cap is used");

// ── 6. What the contract refuses ────────────────────────────────────────────────
const dup = await refusal(() => rail.prepareCharge(mandateId, charges[0].chargeId, 1_000_000n));
ok(/DuplicateCharge/.test(dup ?? ""), `the same charge id again: refused (${dup})`);
const over = await refusal(() => rail.prepareCharge(mandateId, hex(randomBytes(32)), 1_000_000n));
ok(/OverCap/.test(over ?? ""), `a charge over the cap: refused (${over})`);
const revoke = await rail.prepareRevoke(mandateId);
await rail.broadcast(revoke.raw);
ok((await rail.waitFor(revoke)) === "confirmed", `revoked ${link(revoke.hash)}`);
ok(!(await rail.isActive(mandateId)), "the mandate is no longer active");
const afterRevoke = await refusal(() => rail.prepareCharge(mandateId, hex(randomBytes(32)), 1_000_000n));
ok(/Revoked/.test(afterRevoke ?? ""), `a charge after the revoke: refused (${afterRevoke})`);

// ── 7. Public receipts ──────────────────────────────────────────────────────────
const settledAt = new Date();
const leaves = charges.map((c, i) =>
  C.receiptLeaf({ receiptId: c.chargeId.slice(0, 32), amountMinor: c.micro / 10_000n, currency: "USD", provider: "dstv", last4: "4821", settledAt: new Date(settledAt.getTime() + i) }),
);
const tree = C.merkle(leaves);
const anchorer = new C.StellarAnchorer("testnet", operator.secret());
const anchored = await anchorer.anchor(tree.root);
const memo = (await horizon.transactions().transaction(anchored.txHash).call()).memo;
ok(Buffer.from(memo, "base64").toString("hex") === tree.root, `receipts' Merkle root on the ledger ${link(anchored.txHash)}`);
ok(leaves.every((l, i) => C.verifyProof(l, tree.proofs[i], tree.root)), "each receipt's proof leads to that root");

// ── 8. Who paid ────────────────────────────────────────────────────────────────
const end = await rail.accountState(user.publicKey());
ok(end.xlmStroops === 0n, "the user still holds 0 XLM: every fee and reserve was Constant's");

say("");
say(failed ? "SOME CHECKS FAILED" : "ALL PASSED");
if (record) {
  const out = path.join(root, "docs/proof");
  mkdirSync(out, { recursive: true });
  const body = [
    "# Stellar testnet proof run",
    "",
    "Output of `node scripts/stellar/proof-testnet.mjs --record` (D-085). Every link opens the transaction on stellar.expert.",
    "",
    "```",
    ...log,
    "```",
    "",
  ].join("\n");
  writeFileSync(path.join(out, "stellar-testnet.md"), body.replace(/(https:\/\/\S+)/g, "$1"));
  console.log(`wrote docs/proof/stellar-testnet.md`);
}
process.exit(failed ? 1 : 0);
