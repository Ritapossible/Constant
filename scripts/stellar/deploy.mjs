#!/usr/bin/env node
/**
 * Deploys the mandate contract (contracts/mandate/constant_mandate.wasm) and prints the environment for the API and
 * the worker (D-085).
 *
 * On testnet, with no keys given, it makes and funds three (friendbot): the operator (worker; the contract's admin,
 * pays every fee), the sponsor (API; opens users' accounts and pays their reserves) and the treasury (receives the
 * USDC, with a trustline). Its secrets are printed once: paste them into Pxxl's environment, nowhere else.
 *
 *   pnpm --filter @constant/chains build
 *   node scripts/stellar/deploy.mjs                                   # testnet, new keys
 *   STELLAR_OPERATOR_SECRET=S… STELLAR_TREASURY=G… node scripts/stellar/deploy.mjs
 *   STELLAR_NETWORK=public STELLAR_RPC_URL=https://… STELLAR_OPERATOR_SECRET=S… STELLAR_TREASURY=G… node scripts/stellar/deploy.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const req = createRequire(path.join(root, "packages/chains/package.json"));
const S = await import(pathToFileURL(req.resolve("@stellar/stellar-sdk")).href);
const C = await import(pathToFileURL(path.join(root, "packages/chains/dist/index.js")).href);
const { Keypair, Operation, TransactionBuilder, Asset, Horizon } = S;

const network = process.env.STELLAR_NETWORK === "public" ? "public" : "testnet";
const NET = C.STELLAR[network];
const fresh = [];
const key = (name) => {
  if (process.env[name]) return Keypair.fromSecret(process.env[name]);
  if (network !== "testnet") throw new Error(`${name} is required on the public network`);
  const kp = Keypair.random();
  fresh.push([name, kp]);
  return kp;
};

const operator = key("STELLAR_OPERATOR_SECRET");
const sponsor = key("STELLAR_SPONSOR_SECRET");
let treasury = process.env.STELLAR_TREASURY ?? null;
let treasuryKp = null;
if (!treasury) {
  if (network !== "testnet") throw new Error("STELLAR_TREASURY (a G… account with a USDC trustline) is required on the public network");
  treasuryKp = Keypair.random();
  treasury = treasuryKp.publicKey();
}

if (network === "testnet") {
  for (const a of [operator.publicKey(), sponsor.publicKey(), ...(treasuryKp ? [treasury] : [])]) {
    const r = await fetch(`${NET.friendbot}?addr=${a}`);
    if (!r.ok && !(await r.text()).includes("AlreadyExist")) throw new Error(`friendbot refused ${a}`);
  }
}
if (treasuryKp) {
  const horizon = new Horizon.Server(NET.horizon);
  const acct = await horizon.loadAccount(treasury);
  const usdc = new Asset("USDC", C.STELLAR_USDC[network].issuer);
  const tx = new TransactionBuilder(acct, { fee: "1000", networkPassphrase: NET.passphrase }).addOperation(Operation.changeTrust({ asset: usdc })).setTimeout(60).build();
  tx.sign(treasuryKp);
  await horizon.submitTransaction(tx);
}

const dep = await C.deployMandateContract({
  network,
  ...(process.env.STELLAR_RPC_URL ? { rpcUrl: process.env.STELLAR_RPC_URL } : {}),
  operatorSecret: operator.secret(),
  treasury,
  wasm: readFileSync(path.join(root, "contracts/mandate/constant_mandate.wasm")),
});

console.log(`\nMandate contract on ${network}: ${NET.explorer}/contract/${dep.contractId}`);
console.log(`wasm sha256 ${dep.wasmHash}`);
console.log(`operator ${operator.publicKey()}  sponsor ${sponsor.publicKey()}  treasury ${treasury}`);
console.log("\nBoth services (API and worker):");
console.log("  STELLAR_AUTOPAY=true");
console.log(`  STELLAR_NETWORK=${network}`);
console.log(`  STELLAR_MANDATE_CONTRACT=${dep.contractId}`);
if (process.env.STELLAR_RPC_URL) console.log(`  STELLAR_RPC_URL=${process.env.STELLAR_RPC_URL}`);
console.log("API only:");
console.log(`  STELLAR_SPONSOR_SECRET=${fresh.some(([n]) => n === "STELLAR_SPONSOR_SECRET") ? sponsor.secret() : "(the one you passed)"}`);
console.log("Worker only:");
console.log(`  STELLAR_OPERATOR_SECRET=${fresh.some(([n]) => n === "STELLAR_OPERATOR_SECRET") ? operator.secret() : "(the one you passed)"}`);
if (treasuryKp) console.log(`\nTreasury secret (keep offline; testnet only): ${treasuryKp.secret()}`);
if (fresh.length) console.log("\nThese secrets are shown once. Paste them into Pxxl's environment variables, never into the repo or the website.");
