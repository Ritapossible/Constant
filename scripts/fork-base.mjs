#!/usr/bin/env node
/**
 * Fork test for dollar autopay (D-063, D-069): runs Constant's real chain code against a local copy of Base
 * mainnet, through Coinbase's live Smart Wallet factory and Spend Permission Manager, with USDT and USDC.
 * Not part of CI (it needs Foundry's anvil and a Base RPC). Run before any change to the dollar path:
 *
 *   anvil --fork-url https://mainnet.base.org --port 8546 &     # a fresh fork each run
 *   pnpm --filter @constant/chains build
 *   node scripts/fork-base.mjs
 *
 * Last run: 2026-10-11, all checks passed. It found that the manager keeps "approved" after a revoke (D-069).
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.join(root, "packages/chains/package.json"));
const viemPath = pathToFileURL(req.resolve("viem")).href;
const chainsPath = pathToFileURL(path.join(root, "packages/chains/dist/index.js")).href;
const { createPublicClient, createWalletClient, http, parseAbi, encodeAbiParameters, encodeFunctionData, keccak256, pad, toHex, getAddress, erc20Abi } = await import(viemPath);
const { privateKeyToAccount } = await import(pathToFileURL(req.resolve("viem/accounts")).href);
const C = await import(chainsPath);
const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8546";
const chain = { id: 8453, name: "base-fork", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil #0
const SPENDER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil #1
const owner = privateKeyToAccount(OWNER_KEY);
const ownerW = createWalletClient({ chain, transport: http(RPC), account: owner });
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", USDT = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";
const FACTORY = "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842";
const factoryAbi = parseAbi(["function createAccount(bytes[] owners, uint256 nonce) payable returns (address)", "function getAddress(bytes[] owners, uint256 nonce) view returns (address)"]);
const walletAbi = parseAbi(["function addOwnerAddress(address owner)", "function execute(address target, uint256 value, bytes data) payable", "function isOwnerAddress(address) view returns (bool)"]);
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok  ", m); };
const wait = (hash) => pub.waitForTransactionReceipt({ hash });

// 1. A fresh Coinbase Smart Wallet owned by the test key, from Coinbase's live factory.
const owners = [encodeAbiParameters([{ type: "address" }], [owner.address])];
const nonce = BigInt(Date.now());
const account = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getAddress", args: [owners, nonce] });
await wait(await ownerW.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "createAccount", args: [owners, nonce] }));
ok((await pub.getCode({ address: account }))?.length > 2, `smart wallet deployed at ${account}`);

// 2. Give it 100 USDT and 100 USDC by writing the token balance slot (found by probing).
async function deal(token, who, amount) {
  for (let slot = 0n; slot < 60n; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, slot]));
    const before = await pub.request({ method: "eth_getStorageAt", params: [token, key, "latest"] });
    await pub.request({ method: "anvil_setStorageAt", params: [token, key, pad(toHex(amount))] });
    if ((await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] })) === amount) return;
    await pub.request({ method: "anvil_setStorageAt", params: [token, key, before] });
  }
  throw new Error(`no balance slot for ${token}`);
}
await deal(USDT, account, 100_000_000n);
await deal(USDC, account, 100_000_000n);

// 3. The app's one transaction: let the manager act within signed limits.
await wait(await ownerW.writeContract({ address: account, abi: walletAbi, functionName: "addOwnerAddress", args: [C.SPEND_PERMISSION_MANAGER] }));
ok(await pub.readContract({ address: account, abi: walletAbi, functionName: "isOwnerAddress", args: [C.SPEND_PERMISSION_MANAGER] }), "manager added as owner");

// 4. Constant's real chain code, pointed at the fork.
const base = new C.BasePermissionChain(SPENDER_KEY, RPC);
const now = Number((await pub.getBlock()).timestamp);
const perm = (token, salt) => ({ account, spender: base.spender, token, allowance: 20_000_000n, period: 2_592_000, start: now - 60, end: now + 365 * 86_400, salt, extraData: "0x" });
const pUsdt = perm(USDT, 1n), pUsdc = perm(USDC, 2n);

// The production path: the smart wallet signs the EIP-712 permission; the API verifies it; the worker registers it.
const { toCoinbaseSmartAccount } = await import(pathToFileURL(req.resolve("viem/account-abstraction")).href);
const sa = await toCoinbaseSmartAccount({ client: pub, owners: [owner], address: account, version: "1.1" });
for (const p of [pUsdt, pUsdc]) {
  const sig = await sa.signTypedData(C.spendPermissionTypedData(p));
  ok(await base.verifySignature(p, sig), `signature verified for ${p.token === USDT ? "USDT" : "USDC"} (ERC-1271)`);
  const bad = { ...p, allowance: p.allowance + 1n };
  ok(!(await base.verifySignature(bad, sig)), "the same signature doesn't verify a bigger allowance");
  const tx = await base.prepareApprove(p, sig); await base.broadcast(tx.raw); await pub.request({ method: "anvil_mine", params: ["0x5"] });
  ok((await base.status(tx.hash, 5n)) === "confirmed", "approveWithSignature confirmed");
}
ok((await base.isApproved(pUsdt)) && (await base.isApproved(pUsdc)), "USDT and USDC permissions approved on chain");
ok((await base.remainingThisPeriod(pUsdt)) === 20_000_000n, "USDT allowance left this period: 20.00");

async function charge(p, value) {
  const tx = await base.prepareSpend(p, value);
  await base.broadcast(tx.raw);
  await pub.request({ method: "anvil_mine", params: ["0x5"] });
  return base.status(tx.hash, 5n);
}

// 5. Charge 14.888060 USDT (a ₦19,950 bill at ₦1,340): moves exactly that from the user's wallet to the spender.
const bill = 14_888_060n;
ok((await charge(pUsdt, bill)) === "confirmed", "USDT charge confirmed");
ok((await base.balanceOf(USDT, account)) === 100_000_000n - bill, "user's USDT down by exactly the charge");
ok((await base.balanceOf(USDT, base.spender)) === bill, "spender received exactly the charge");
ok((await base.remainingThisPeriod(pUsdt)) === 20_000_000n - bill, "allowance left reduced by the charge");
ok((await pub.readContract({ address: USDT, abi: erc20Abi, functionName: "allowance", args: [account, C.SPEND_PERMISSION_MANAGER] })) === 0n, "no USDT allowance left behind (USDT approve quirk can't jam the next charge)");

// 6. A second charge in the same period: within the cap works, above it is refused by the contract.
ok((await charge(pUsdt, 5_000_000n)) === "confirmed", "second USDT charge within the cap confirmed");
let refused = false;
try { await base.prepareSpend(pUsdt, 1_000_000n); } catch { refused = true; }
ok(refused, "a charge above what's left this period is refused (cannot even be prepared)");

// 7. USDC alongside, independent cap.
ok((await charge(pUsdc, bill)) === "confirmed", "USDC charge confirmed, separate permission");

// 8. Another spender can't use the permission.
const thief = new C.BasePermissionChain("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", RPC);
let stolen = false;
try { await thief.prepareSpend(pUsdc, 1_000_000n); stolen = true; } catch {}
ok(!stolen, "a different spender key cannot charge");

// 9. Revoke by the spender, then nothing can be charged.
const rv = await base.prepareRevoke(pUsdt); await base.broadcast(rv.raw); await pub.request({ method: "anvil_mine", params: ["0x5"] });
ok(!(await base.isApproved(pUsdt)), "USDT permission revoked by Constant's spender: no longer usable");
let afterRevoke = false;
try { await base.prepareSpend(pUsdt, 1_000_000n); afterRevoke = true; } catch {}
ok(!afterRevoke, "a revoked permission cannot be charged");

// The user revokes USDC from their own wallet, outside Constant: our check sees it at once.
const userRevoke = encodeFunctionData({ abi: C.SPEND_PERMISSION_MANAGER_ABI, functionName: "revoke", args: [pUsdc] });
await wait(await ownerW.writeContract({ address: account, abi: walletAbi, functionName: "execute", args: [C.SPEND_PERMISSION_MANAGER, 0n, userRevoke] }));
ok(!(await base.isApproved(pUsdc)), "a revoke from the user's own wallet is seen as not usable");

// 10. Sweep the charged USDT to a treasury.
const treasury = "0x7777777777777777777777777777777777777777";
const held = await base.balanceOf(USDT, base.spender);
const sw = await base.prepareTransfer(USDT, treasury, held); await base.broadcast(sw.raw); await pub.request({ method: "anvil_mine", params: ["0x5"] });
ok((await base.status(sw.hash, 5n)) === "confirmed" && (await base.balanceOf(USDT, treasury)) === held, `swept ${held} micro-USDT to the treasury`);
console.log("ALL PASSED");
