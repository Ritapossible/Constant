#!/usr/bin/env node
/**
 * Proof run for ConstantMandate (D-072) on a live chain: QIE testnet (1983) or a local anvil (31337). Never mainnet.
 * Plays a user and ConstantUnits's spender with fresh keys each run, funded with gas by the deployer, and checks
 * every rule on chain: deposit, open a line, a charge to the treasury, then the refusals (same order twice, over
 * the allowance, a stranger, while paused, after a revoke), a withdrawal while paused, and the events.
 *
 *   cd contracts/qie && forge build
 *   QIE_RPC=https://rpc2testnet.qie.digital/ QIE_DEPLOYER_KEY=0x… QIE_MANDATE=0x… node scripts/qie/proof-testnet.mjs
 *
 * QIE_DEPLOYER_KEY must be the mandate's owner (it pauses and unpauses) and hold some testnet QIE for gas.
 * The stablecoin must be TestStable (it mints from its faucet).
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "packages/chains/package.json"));
const viem = await import(pathToFileURL(req.resolve("viem")).href);
const { generatePrivateKey, privateKeyToAccount } = await import(pathToFileURL(req.resolve("viem/accounts")).href);
const { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatUnits, keccak256, toHex, decodeErrorResult, parseEventLogs, BaseError, ContractFunctionRevertedError } = viem;

const artifact = (name) => JSON.parse(readFileSync(path.join(root, `contracts/qie/out/${name}.sol/${name}.json`), "utf8")).abi;
const mandateAbi = artifact("ConstantMandate");
const stableAbi = artifact("TestStable");

const RPC = process.env.QIE_RPC ?? "https://rpc2testnet.qie.digital/";
const pub0 = createPublicClient({ transport: http(RPC) });
const chainId = await pub0.getChainId();
if (chainId !== 1983 && chainId !== 31337) throw new Error(`proof: chain ${chainId} is not QIE testnet or local; refusing`);
const chain = {
  id: chainId,
  name: chainId === 1983 ? "QIE testnet" : "local",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const explorer = chainId === 1983 ? "https://testnet.qie.digital" : null;
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = (account) => createWalletClient({ chain, transport: http(RPC), account });

const deployer = privateKeyToAccount(process.env.QIE_DEPLOYER_KEY);
const user = privateKeyToAccount(generatePrivateKey());
const spender = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const mandate = process.env.QIE_MANDATE;
const token = await pub.readContract({ address: mandate, abi: mandateAbi, functionName: "token" });
const treasury = await pub.readContract({ address: mandate, abi: mandateAbi, functionName: "treasury" });
const owner = await pub.readContract({ address: mandate, abi: mandateAbi, functionName: "owner" });
if (owner.toLowerCase() !== deployer.address.toLowerCase()) throw new Error("proof: QIE_DEPLOYER_KEY is not the owner");

let passed = 0;
const ok = (what, cond) => {
  if (!cond) throw new Error(`FAILED: ${what}`);
  passed++;
  console.log(`  ✓ ${what}`);
};
const link = (hash) => (explorer ? `${explorer}/tx/${hash}` : hash);

async function send(account, address, abi, functionName, args, value) {
  const hash = await wallet(account).writeContract({ address, abi, functionName, args, value });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`${functionName} reverted: ${link(hash)}`);
  console.log(`    ${functionName} ${link(hash)}`);
  return rcpt;
}

/** Simulates a call from `account` and returns the custom error's name, or null if it would succeed. */
async function refusal(account, functionName, args) {
  try {
    await pub.simulateContract({ address: mandate, abi: mandateAbi, functionName, args, account });
    return null;
  } catch (e) {
    const revert = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    if (revert?.data?.errorName) return revert.data.errorName;
    const data = e?.cause?.data ?? e?.data;
    if (typeof data === "string") return decodeErrorResult({ abi: mandateAbi, data }).errorName;
    throw e;
  }
}

const usd = (n) => parseUnits(String(n), 6);
const bal = (who) => pub.readContract({ address: token, abi: stableAbi, functionName: "balanceOf", args: [who] });
const inMandate = (who) => pub.readContract({ address: mandate, abi: mandateAbi, functionName: "balanceOf", args: [who] });

console.log(`chain ${chainId} · mandate ${mandate} · token ${token} · treasury ${treasury}`);
console.log(`user ${user.address} · spender ${spender.address}`);

// Gas for the two fresh accounts, from the deployer.
for (const a of [user, spender]) {
  const hash = await wallet(deployer).sendTransaction({ to: a.address, value: parseEther(process.env.QIE_GAS ?? "0.05") });
  await pub.waitForTransactionReceipt({ hash });
}

console.log("1. The user deposits $100 and opens a $25-a-day line for ConstantUnits's spender");
await send(user, token, stableAbi, "faucet", [user.address, usd(100)]);
await send(user, token, stableAbi, "approve", [mandate, usd(100)]);
await send(user, mandate, mandateAbi, "deposit", [usd(100)]);
ok("balance in the mandate is $100", (await inMandate(user.address)) === usd(100));
const lineId = keccak256(toHex(`proof-line-${Date.now()}`));
await send(user, mandate, mandateAbi, "openLine", [lineId, spender.address, usd(25), 86_400n]);

console.log("2. The spender charges $10 for an order; it reaches the treasury");
const orderA = keccak256(toHex(`proof-order-a-${Date.now()}`));
const t0 = await bal(treasury);
const rc = await send(spender, mandate, mandateAbi, "charge", [user.address, lineId, usd(10), orderA]);
ok("treasury received exactly $10", (await bal(treasury)) - t0 === usd(10));
ok("user's mandate balance is $90", (await inMandate(user.address)) === usd(90));
const [ev] = parseEventLogs({ abi: mandateAbi, logs: rc.logs, eventName: "Charged" });
ok("Charged event names the user, line, order and amount", ev && ev.args.user === user.address && ev.args.lineId === lineId && ev.args.orderId === orderA && ev.args.amount === usd(10));

console.log("3. Everything that must be refused is refused");
ok("the same order again → OrderAlreadyCharged", (await refusal(spender, "charge", [user.address, lineId, usd(1), orderA])) === "OrderAlreadyCharged");
ok("$16 more today (cap $25, $10 used) → OverAllowance", (await refusal(spender, "charge", [user.address, lineId, usd(16), keccak256(toHex("b"))])) === "OverAllowance");
ok("a stranger charging → NotSpender", (await refusal(stranger, "charge", [user.address, lineId, usd(1), keccak256(toHex("c"))])) === "NotSpender");
ok("the owner charging → NotSpender", (await refusal(deployer, "charge", [user.address, lineId, usd(1), keccak256(toHex("d"))])) === "NotSpender");
ok("a stranger withdrawing the user's money → InsufficientBalance", (await refusal(stranger, "withdraw", [usd(1)])) === "InsufficientBalance");
ok("$15 more today is still allowed", (await refusal(spender, "charge", [user.address, lineId, usd(15), keccak256(toHex("e"))])) === null);

console.log("4. Paused: charges stop, the user can still withdraw");
await send(deployer, mandate, mandateAbi, "pause", []);
ok("a charge while paused → EnforcedPause", (await refusal(spender, "charge", [user.address, lineId, usd(1), keccak256(toHex("f"))])) === "EnforcedPause");
await send(user, mandate, mandateAbi, "withdraw", [usd(50)]);
ok("user withdrew $50 while paused", (await bal(user.address)) === usd(50) && (await inMandate(user.address)) === usd(40));
await send(deployer, mandate, mandateAbi, "unpause", []);

console.log("5. The user revokes the line; it can never be charged again");
await send(user, mandate, mandateAbi, "revoke", [lineId]);
ok("a charge after revoke → LineRevoked", (await refusal(spender, "charge", [user.address, lineId, usd(1), keccak256(toHex("g"))])) === "LineRevoked");
const [left] = await pub.readContract({ address: mandate, abi: mandateAbi, functionName: "available", args: [user.address, lineId] });
ok("available() reads $0 after revoke", left === 0n);
ok("the contract holds at least every balance", (await bal(mandate)) >= (await pub.readContract({ address: mandate, abi: mandateAbi, functionName: "totalBalances" })));

console.log(`\nAll ${passed} checks passed on chain ${chainId}. Remaining with the user: $${formatUnits(await inMandate(user.address), 6)}.`);
