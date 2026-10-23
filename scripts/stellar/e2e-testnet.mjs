#!/usr/bin/env node
/**
 * End to end on Stellar testnet (D-085): ConstantUnits' own API and worker code, unchanged, take one cable TV bill
 * from "link your Stellar account" to "renewed and paid in USDC", then stop it. Only the identity provider, the
 * vending partner and the exchange rate are stand-ins; every Stellar step is a real testnet transaction.
 *
 *   API     link the account (SEP-53 message signature) → sponsored onboarding (user signs a hash, holds no XLM)
 *           → add the bill → proposal → the user signs one authorization → stored as "signed"
 *   worker  registers the mandate on chain → renewal due → charges USDC to the treasury (saved, then sent)
 *           → credits exactly the naira → vends → the user stops it in the app → mandate revoked on chain
 *
 * Needs a local Postgres (TEST_DATABASE_URL) and the built packages:
 *   pnpm -r --filter "./packages/*" --filter "./apps/api" --filter "./apps/worker" build
 *   TEST_DATABASE_URL=postgres://… node scripts/stellar/e2e-testnet.mjs        # --record writes docs/proof/stellar-e2e.md
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const req = createRequire(path.join(root, "packages/chains/package.json"));
const S = await import(pathToFileURL(req.resolve("@stellar/stellar-sdk")).href);
const C = await load("packages/chains/dist/index.js");
const DB = await load("packages/db/dist/index.js");
const P = await load("packages/partners/dist/index.js");
const API = await load("apps/api/dist/index.js");
const W = await load("apps/worker/dist/index.js");
const { Keypair, Operation, TransactionBuilder, Asset, Horizon } = S;

if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL (a local Postgres the script may create a database in)");
const NET = C.STELLAR.testnet;
const record = process.argv.includes("--record");
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
const link = (h) => `${NET.explorer}/tx/${h}`;
const sign = (kp, hex) => Buffer.from(kp.sign(Buffer.from(hex, "hex"))).toString("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const friendbot = async (a) => {
  const r = await fetch(`${NET.friendbot}?addr=${a}`);
  if (!r.ok && !(await r.text()).includes("AlreadyExist")) throw new Error(`friendbot refused ${a}`);
};

say(`# Stellar testnet, end to end through the API and worker, ${new Date().toISOString()}`);

// ── Constant's keys and contract ───────────────────────────────────────────────
const operator = Keypair.random(); // the worker's key: the contract's admin, charges and revokes
const sponsor = Keypair.random(); // the API's key: opens users' accounts, can't charge
const treasury = Keypair.random();
await Promise.all([operator, sponsor, treasury].map((k) => friendbot(k.publicKey())));
const horizon = new Horizon.Server(NET.horizon);
const usdc = new Asset("USDC", C.STELLAR_USDC.testnet.issuer);
{
  const acct = await horizon.loadAccount(treasury.publicKey());
  const tx = new TransactionBuilder(acct, { fee: "1000", networkPassphrase: NET.passphrase }).addOperation(Operation.changeTrust({ asset: usdc })).setTimeout(60).build();
  tx.sign(treasury);
  await horizon.submitTransaction(tx);
}
const dep = await C.deployMandateContract({
  network: "testnet",
  operatorSecret: operator.secret(),
  treasury: treasury.publicKey(),
  wasm: readFileSync(path.join(root, "contracts/mandate/constant_mandate.wasm")),
});
say(`contract ${NET.explorer}/contract/${dep.contractId}`);
say(`operator (worker) ${operator.publicKey()} · sponsor (API) ${sponsor.publicKey()} · treasury ${treasury.publicKey()}`);
const workerRail = new C.StellarRail({ network: "testnet", contractId: dep.contractId, operatorSecret: operator.secret() });
const apiRail = new C.StellarRail({ network: "testnet", contractId: dep.contractId, operatorSecret: sponsor.secret() });

// ── The app, as deployed, with stand-ins for sign-in, vending and the rate ──────
const { db, drop } = await DB.freshDatabase();
// Vending starts switched off in a new database (the kill switch); an operator turns it on.
await DB.setVendingEnabled(db, true, "e2e", "Stellar testnet proof run");
const secrets = new DB.Secrets({ encryption: [{ id: "k1", key: Buffer.from(DB.testKeyB64(), "base64") }], hmac: Buffer.from(DB.testKeyB64(), "base64") });
const vending = new P.FakeCableVending();
const DUE = new Date(Date.now() + 6 * 3_600_000);
vending.decoders.set("7012345678", { customerName: "ADA OBI", plan: "DStv Compact", renewalAmountMinor: 1_995_000n, dueAt: DUE });
const rates = new P.FakeRates("1352.34");
const app = await API.buildApp({
  db,
  identity: new P.FakeIdentity(),
  vending,
  funding: new P.FakeFunding("whsec"),
  secrets,
  webOrigins: ["https://constant-units.vercel.app"],
  vtpassWebhookToken: "vt-0123456789abcdef",
  fundingEmailDomain: "users.example",
  logger: false,
  stellar: { rail: apiRail, rates },
});
const did = "did:privy:stellar-e2e";
const call = async (method, url, body) => {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer fake:${did}`, "content-type": "application/json" }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
const deps = {
  db,
  vending,
  messaging: new P.FakeMessaging(),
  secrets,
  log: process.env.DEBUG_LOG ? W.jsonLog("e2e") : W.silentLog,
  now: () => new Date(),
  fallbackPhone: "08000000000",
  dollars: { stellar: { rail: workerRail }, rates, confirmations: 1n, screeningRequired: false, dailyLimitMicro: 10n ** 12n, floatMarginMinor: 0n, sweepMinMicro: 50_000_000n },
};
const until = async (what, fn, ms = 120_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(2_000);
  }
};

try {
  // ── API: link, onboard, the bill, the mandate ──────────────────────────────────
  const user = Keypair.random();
  say(`user ${user.publicKey()}`);
  const ch = (await call("POST", "/v1/stellar/link/challenge", { account: user.publicKey() })).body;
  const linked = await call("POST", "/v1/stellar/link", { requestId: ch.requestId, signature: sign(user, ch.payload) });
  ok(linked.status === 200 && linked.body.account === user.publicKey(), `linked by signing: "${ch.message}"`);

  const ob = (await call("POST", "/v1/stellar/onboarding")).body;
  const opened = await call("POST", "/v1/stellar/onboarding/submit", { requestId: ob.requestId, signature: sign(user, ob.hash) });
  ok(opened.status === 200 && opened.body.ready, `account opened for USDC, reserves sponsored ${link(opened.body.txHash)}`);
  ok((await apiRail.accountState(user.publicKey())).xlmStroops === 0n, "the user holds 0 XLM");

  {
    const acct = await horizon.loadAccount(operator.publicKey());
    const tx = new TransactionBuilder(acct, { fee: "1000", networkPassphrase: NET.passphrase })
      .addOperation(Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: "500", destination: user.publicKey(), destAsset: usdc, destAmount: "30", path: [] }))
      .setTimeout(60)
      .build();
    tx.sign(operator);
    say(`  30 Circle testnet USDC arrive ${link((await horizon.submitTransaction(tx)).hash)}`);
  }

  const line = await call("POST", "/v1/lines", { provider: "dstv", smartcard: "7012345678", nickname: "Living room", capMinor: "2500000" });
  ok(line.status === 201 || line.status === 200, `bill added: DStv Compact, ₦19,950 due ${DUE.toISOString()}`);
  const lineId = line.body.id;
  const prop = (await call("POST", `/v1/lines/${lineId}/stellar/proposal`)).body;
  ok(!!prop.payload, `proposal: up to ${prop.display.capUsd} USDC every ${prop.display.periodDays} days, until ${prop.display.until.slice(0, 10)}`);
  const signed = await call("POST", `/v1/lines/${lineId}/stellar`, { requestId: prop.requestId, signature: sign(user, prop.payload) });
  ok(signed.status === 202, "the user's one signature is stored; nothing is on chain yet");

  // ── Worker: register, renew, charge, vend ───────────────────────────────────────
  const perm = async () => (await db.query("SELECT * FROM spend_permissions WHERE line_id = $1", [lineId])).rows[0];
  await until("the mandate", async () => {
    await W.processPermissions(deps, deps.dollars);
    return (await perm()).status === "approved";
  });
  const p = await perm();
  ok(true, `mandate registered by the worker ${link(p.tx_hash)}`);
  ok((await db.query("SELECT funding FROM lines WHERE id = $1", [lineId])).rows[0].funding === "stables", "the bill now pays from USDC on Stellar");

  await db.query("UPDATE lines SET next_run_at = now() - interval '1 minute' WHERE id = $1", [lineId]);
  ok((await W.scanRenewals(deps)) === 1, "renewal due: one order");
  const charge = async () => (await db.query("SELECT c.*, o.state FROM charges c JOIN orders o ON o.id = c.order_id WHERE o.line_id = $1", [lineId])).rows[0];
  await until("the vend", async () => {
    await db.query("UPDATE orders SET next_check_at = now() WHERE line_id = $1 AND state IN ('ready','vending')", [lineId]);
    await W.processOrders(deps);
    return vending.calls.renew.length === 1;
  });
  const c = await charge();
  ok(c.status === "confirmed", `charged ${C.formatUnits6(BigInt(c.amount_micro))} USDC, confirmed before the vend ${link(c.tx_hash)}`);
  const treasuryUsdc = (await horizon.loadAccount(treasury.publicKey())).balances.find((b) => b.asset_code === "USDC")?.balance;
  ok(Number(treasuryUsdc) * 1_000_000 === Number(c.amount_micro), `the treasury holds ${treasuryUsdc} USDC`);
  const fund = (await db.query("SELECT amount_minor, actor FROM ledger_entries WHERE kind = 'fund' AND external_ref = $1", [c.tx_hash])).rows[0];
  ok(fund && fund.actor === "stellar" && BigInt(fund.amount_minor) === BigInt(c.naira_minor), `credited exactly ₦${Number(c.naira_minor) / 100} against that transaction`);
  ok(vending.calls.renew.length === 1, "the decoder was renewed once");

  // ── Stop ──────────────────────────────────────────────────────────────────────
  ok((await call("DELETE", `/v1/lines/${lineId}/stellar`)).status === 204, "the user stops it in the app");
  await until("the revoke", async () => {
    await W.processPermissions(deps, deps.dollars);
    return (await perm()).status === "revoked";
  });
  const mandateId = BigInt((await perm()).salt).toString(16).padStart(64, "0");
  ok(!(await workerRail.isActive(mandateId)), `mandate revoked on chain by the worker ${link((await perm()).tx_hash)}`);
  ok((await apiRail.accountState(user.publicKey())).xlmStroops === 0n, "the user still holds 0 XLM");
} catch (err) {
  failed = true;
  say(`FAIL ${err.message}`);
} finally {
  await app.close();
  await drop();
}

say("");
say(failed ? "SOME CHECKS FAILED" : "ALL PASSED");
if (record) {
  mkdirSync(path.join(root, "docs/proof"), { recursive: true });
  writeFileSync(
    path.join(root, "docs/proof/stellar-e2e.md"),
    ["# Stellar testnet: end to end through the API and worker", "", "Output of `node scripts/stellar/e2e-testnet.mjs --record` (D-085).", "", "```", ...log, "```", ""].join("\n"),
  );
  console.log("wrote docs/proof/stellar-e2e.md");
}
process.exit(failed ? 1 : 0);
