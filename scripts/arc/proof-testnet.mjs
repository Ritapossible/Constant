#!/usr/bin/env node
/**
 * The Arc proof run (D-070), on Arc testnet and Base Sepolia, with Constant's own chain code:
 *   1. Coinbase's Spend Permission Manager is deployed on Arc (run deploy-spend-permissions.mjs first).
 *   2. A Coinbase Smart Wallet on Arc: Arc testnet has no Coinbase factory, so this copies the exact code live on
 *      Arc mainnet (wallet implementation and factory) to testnet. On mainnet the real factory is used.
 *   3. The wallet adds the manager as owner, signs a USDC permission for Arc's chain id; Constant verifies it,
 *      registers it, charges USDC on Arc, the cap holds, a revoke stops it.
 *   4. Constant moves the charged USDC to Base Sepolia with CCTP: approve + burn on Arc, Circle's attestation,
 *      mint on Base Sepolia.
 *
 * Needs one key with Arc testnet USDC (faucet.circle.com, "Arc Testnet", ~5 USDC) and a little Base Sepolia ETH
 * for the mint (any Base Sepolia faucet). Never a mainnet key.
 *
 *   pnpm --filter @constant/chains build
 *   PROOF_KEY=0x… node scripts/arc/proof-testnet.mjs            # add --skip-bridge to stop after step 3
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const req = createRequire(path.join(root, "packages/chains/package.json"));
const viem = await import(pathToFileURL(req.resolve("viem")).href);
const { privateKeyToAccount, generatePrivateKey } = await import(pathToFileURL(req.resolve("viem/accounts")).href);
const { toCoinbaseSmartAccount } = await import(pathToFileURL(req.resolve("viem/account-abstraction")).href);
const C = await import(pathToFileURL(path.join(root, "packages/chains/dist/index.js")).href);
const { createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters, erc20Abi, concat, getAddress } = viem;

const KEY = process.env.PROOF_KEY;
if (!KEY) throw new Error("Set PROOF_KEY (a testnet-only key with Arc testnet USDC)");
const ARC_RPC = process.env.ARC_TESTNET_RPC_URL || C.EVM_TESTNETS.arc.defaultRpc;
const BASE_RPC = process.env.BASE_SEPOLIA_RPC_URL || C.EVM_TESTNETS.base.defaultRpc;
const MAINNET_ARC_RPC = process.env.ARC_RPC_URL || C.EVM_CHAINS.arc.defaultRpc;
const skipBridge = process.argv.includes("--skip-bridge");

const arcChain = C.viemChain("arc", ARC_RPC, true);
const arc = createPublicClient({ chain: arcChain, transport: http(ARC_RPC, { timeout: 60_000 }) });
const mainArc = createPublicClient({ transport: http(MAINNET_ARC_RPC, { timeout: 60_000 }) });
const funder = privateKeyToAccount(KEY);
const funderW = createWalletClient({ chain: arcChain, transport: http(ARC_RPC), account: funder });
const USDC = "0x3600000000000000000000000000000000000000";
const MANAGER = C.SPEND_PERMISSION_MANAGER;
const FACTORY_V11 = "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842";

let failed = false;
const ok = (c, m) => {
  console.log(`${c ? "ok  " : "FAIL"} ${m}`);
  if (!c) failed = true;
};
const stop = (m) => {
  console.error(`STOP: ${m}`);
  process.exit(1);
};
const wait = async (hash) => {
  const r = await arc.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") stop(`transaction reverted: ${hash}`);
  return r;
};
const usdcOf = (who) => arc.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const fmt = (m) => `${m / 1_000_000n}.${(m % 1_000_000n).toString().padStart(6, "0")}`;

console.log(`Arc testnet chain ${await arc.getChainId()}, key ${funder.address}, USDC ${fmt(await usdcOf(funder.address))}`);
if ((await usdcOf(funder.address)) < 3_000_000n) stop("the key needs at least 3 USDC on Arc testnet (faucet.circle.com)");

// ── 1. Coinbase's manager ──────────────────────────────────────────────────────
const spender = new C.EvmPermissionChain("arc", KEY, ARC_RPC, { testnet: true });
if (!(await spender.managerDeployed())) stop("Spend Permission Manager not deployed on Arc testnet: run scripts/arc/deploy-spend-permissions.mjs --broadcast");
ok(true, `Spend Permission Manager at ${MANAGER}`);

// ── 2. Coinbase Smart Wallet code on testnet ───────────────────────────────────
/** Deploys `runtime` as-is (initcode: copy the code that follows, return it). */
async function deployRuntime(runtime) {
  const len = (runtime.length - 2) / 2;
  const hexLen = len.toString(16).padStart(4, "0");
  // PUSH2 len, DUP1, PUSH1 0x0c, PUSH1 0, CODECOPY, PUSH1 0, RETURN (12 bytes), then the code at offset 12.
  const init = concat([`0x61${hexLen}80600c6000396000f3`, runtime]);
  const hash = await funderW.sendTransaction({ data: init });
  const r = await wait(hash);
  return r.contractAddress;
}
let factory = FACTORY_V11;
if (!(await arc.getCode({ address: FACTORY_V11 }))) {
  const mainImpl = await mainArc.readContract({ address: FACTORY_V11, abi: parseAbi(["function implementation() view returns (address)"]), functionName: "implementation" });
  const implCode = await mainArc.getCode({ address: mainImpl });
  const factoryCode = await mainArc.getCode({ address: FACTORY_V11 });
  const impl = await deployRuntime(implCode);
  const needle = mainImpl.toLowerCase().slice(2);
  const patched = factoryCode.toLowerCase().split(needle).join(impl.toLowerCase().slice(2));
  if (patched === factoryCode.toLowerCase()) stop("factory code doesn't embed its implementation address");
  factory = await deployRuntime(patched);
  ok(true, `Coinbase Smart Wallet v1.1 copied from Arc mainnet: implementation ${impl}, factory ${factory}`);
}

const ownerKey = generatePrivateKey();
const owner = privateKeyToAccount(ownerKey);
const ownerW = createWalletClient({ chain: arcChain, transport: http(ARC_RPC), account: owner });
// Gas on Arc is USDC: give the owner a little (native units have 18 decimals).
await wait(await funderW.sendTransaction({ to: owner.address, value: 200_000_000_000_000_000n }));
const FACTORY_ABI = parseAbi(["function createAccount(bytes[] owners, uint256 nonce) payable returns (address)", "function getAddress(bytes[] owners, uint256 nonce) view returns (address)"]);
const WALLET_ABI = parseAbi(["function addOwnerAddress(address owner)", "function isOwnerAddress(address) view returns (bool)"]);
const owners = [encodeAbiParameters([{ type: "address" }], [owner.address])];
const account = await arc.readContract({ address: factory, abi: FACTORY_ABI, functionName: "getAddress", args: [owners, 0n] });
await wait(await ownerW.writeContract({ address: factory, abi: FACTORY_ABI, functionName: "createAccount", args: [owners, 0n] }));
ok(!!(await arc.getCode({ address: account })), `smart wallet ${account}`);
await wait(await funderW.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [account, 2_000_000n] }));
ok((await usdcOf(account)) === 2_000_000n, "wallet holds 2.000000 USDC (ERC-20 interface, 6 decimals)");

// ── 3. Permission, charge, cap, revoke ─────────────────────────────────────────
await wait(await ownerW.writeContract({ address: account, abi: WALLET_ABI, functionName: "addOwnerAddress", args: [MANAGER] }));
ok(await arc.readContract({ address: account, abi: WALLET_ABI, functionName: "isOwnerAddress", args: [MANAGER] }), "manager added as owner");
const now = Number((await arc.getBlock()).timestamp);
const perm = { account, spender: spender.spender, token: USDC, allowance: 1_500_000n, period: 2_592_000, start: now - 60, end: now + 86_400, salt: BigInt(Date.now()), extraData: "0x" };
const sa = await toCoinbaseSmartAccount({ client: arc, owners: [owner], address: account, version: "1.1" });
const sig = await sa.signTypedData(C.spendPermissionTypedData(perm, arcChain.id));
ok(await spender.verifySignature(perm, sig), `signature verified for Arc's chain id ${arcChain.id}`);
ok(!(await spender.verifySignature({ ...perm, allowance: perm.allowance + 1n }, sig)), "the same signature doesn't cover a bigger allowance");
const send = async (prepared) => {
  await spender.broadcast(prepared.raw);
  await arc.waitForTransactionReceipt({ hash: prepared.hash, timeout: 120_000 });
  return spender.status(prepared.hash, 1n);
};
ok((await send(await spender.prepareApprove(perm, sig))) === "confirmed", "approveWithSignature confirmed on Arc");
ok(await spender.isApproved(perm), "permission valid on chain");
const before = await usdcOf(spender.spender);
ok((await send(await spender.prepareSpend(perm, 1_000_000n))) === "confirmed", "charged 1.000000 USDC on Arc");
ok((await usdcOf(account)) === 1_000_000n, "wallet down by exactly the charge");
// The spender also paid gas in USDC: its balance rose by the charge less gas.
const gained = (await usdcOf(spender.spender)) - before;
ok(gained > 990_000n && gained <= 1_000_000n, `spender received the charge (net of gas: ${fmt(gained)})`);
ok((await spender.remainingThisPeriod(perm)) === 500_000n, "0.500000 left this period");
let over = false;
try {
  await spender.prepareSpend(perm, 600_000n);
  over = true;
} catch {}
ok(!over, "a charge above what's left is refused");
ok((await send(await spender.prepareRevoke(perm))) === "confirmed", "revoked by the spender");
ok(!(await spender.isApproved(perm)), "no longer usable");

// ── 4. CCTP: Arc → Base Sepolia ────────────────────────────────────────────────
if (!skipBridge) {
  const bridge = new C.CctpBridge("arc", "base", KEY, { arc: ARC_RPC, base: BASE_RPC }, { testnet: true });
  const base = createPublicClient({ chain: C.viemChain("base", BASE_RPC, true), transport: http(BASE_RPC, { timeout: 60_000 }) });
  const baseUsdc = () => base.readContract({ address: C.BASE_SEPOLIA_USDC, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(spender.spender)] });
  const amount = 1_000_000n;
  const fee = await bridge.fee(amount);
  console.log(`CCTP fee for ${fmt(amount)}: ${fmt(fee)}`);
  const startBase = await baseUsdc();
  const { approve, burn } = await bridge.prepareBurn(amount, fee);
  await bridge.broadcast("arc", approve.raw);
  await bridge.broadcast("arc", burn.raw);
  await arc.waitForTransactionReceipt({ hash: burn.hash, timeout: 120_000 });
  ok((await bridge.status("arc", burn.hash, 1n)) === "confirmed", `burned on Arc: ${burn.hash}`);
  let a = { status: "pending" };
  for (let i = 0; i < 60 && a.status !== "complete"; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    a = await bridge.attestation(burn.hash).catch(() => ({ status: "pending" }));
  }
  ok(a.status === "complete", "Circle attested the burn");
  if (a.status === "complete") {
    const mint = await bridge.prepareMint(a.message, a.attestation);
    await bridge.broadcast("base", mint.raw);
    await base.waitForTransactionReceipt({ hash: mint.hash, timeout: 120_000 });
    ok((await bridge.status("base", mint.hash, 1n)) === "confirmed", `minted on Base Sepolia: ${mint.hash}`);
    ok((await baseUsdc()) - startBase === amount - fee, `spender's Base Sepolia USDC up by ${fmt(amount - fee)}`);
  }
}

console.log(failed ? "SOME CHECKS FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
