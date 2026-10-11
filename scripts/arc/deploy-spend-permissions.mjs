#!/usr/bin/env node
/**
 * Deploys Coinbase's Spend Permission Manager and its PublicERC6492Validator on Arc (D-070), at the same addresses
 * and with the same code as on Base. Nothing here is Constant's own contract.
 *
 * spend-permissions-initcode.json holds Coinbase's creation code (github.com/coinbase/spend-permissions, tag v1.0.0,
 * solc 0.8.28, FOUNDRY_PROFILE=deploy) with the metadata of the contracts live on Base; rebuild-initcode.sh
 * reproduces it. Deployed through the standard CREATE2 deployer with salt 0, as Coinbase's Deploy.s.sol does, so
 * the address itself proves the code: CREATE2 addresses are a hash of the code.
 *
 * Refuses to send anything unless the computed addresses equal Base's. After deploying, checks the code on Arc is
 * byte-for-byte the code on Base except the values the constructor stores (immutables), and reads those back: the
 * EIP-712 domain must name this chain and this address, and the validator must be the one deployed here.
 *
 *   ARC_RPC_URL=https://rpc.testnet.arc.network node scripts/arc/deploy-spend-permissions.mjs            # check only
 *   ARC_RPC_URL=… DEPLOYER_PRIVATE_KEY=0x… node scripts/arc/deploy-spend-permissions.mjs --broadcast     # deploy
 *
 * The deployer key needs a little USDC on Arc for gas (testnet: faucet.circle.com). It gets no rights over
 * the contracts: they have no owner.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const req = createRequire(path.join(root, "packages/chains/package.json"));
const { createPublicClient, createWalletClient, encodeAbiParameters, getContractAddress, http, concat, pad } = await import(pathToFileURL(req.resolve("viem")).href);
const { privateKeyToAccount } = await import(pathToFileURL(req.resolve("viem/accounts")).href);

const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const SALT = pad("0x00", { size: 32 });
// Coinbase's Deploy.s.sol: MagicSpend v1.0.0. Only spendWithWithdraw uses it; Constant never calls that.
const MAGIC_SPEND = "0x011A61C07DbF256A68256B1cB51A5e246730aB92";
const EXPECTED = {
  PublicERC6492Validator: "0xcfCE48B757601F3f351CB6f434CB0517aEEE293D",
  SpendPermissionManager: "0xf85210B21cC50302F477BA56686d2019dC9b67Ad",
};

const rpc = process.env.ARC_RPC_URL;
if (!rpc) throw new Error("Set ARC_RPC_URL");
const broadcast = process.argv.includes("--broadcast");
const arc = createPublicClient({ transport: http(rpc, { timeout: 30_000 }) });
const base = createPublicClient({ transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org", { timeout: 30_000 }) });
const chainId = await arc.getChainId();
console.log(`Arc RPC chain id ${chainId}${broadcast ? "" : " (check only; add --broadcast to deploy)"}`);

const init = JSON.parse(readFileSync(path.join(here, "spend-permissions-initcode.json"), "utf8"));
const steps = [
  { name: "PublicERC6492Validator", initCode: init.PublicERC6492Validator },
  {
    name: "SpendPermissionManager",
    initCode: concat([init.SpendPermissionManager, encodeAbiParameters([{ type: "address" }, { type: "address" }], [EXPECTED.PublicERC6492Validator, MAGIC_SPEND])]),
  },
];

/** Runtime code with the constructor-set values (immutables) blanked, so two deployments can be compared. */
const masked = (code, name) => {
  const h = (code ?? "0x").toLowerCase().slice(2).split("");
  for (const { start, length } of init.immutableReferences[name]) h.splice(start * 2, length * 2, ..."0".repeat(length * 2));
  return h.join("");
};
const MANAGER_ABI = [
  { type: "function", name: "eip712Domain", stateMutability: "view", inputs: [], outputs: [{ type: "bytes1" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint256[]" }] },
  { type: "function", name: "PUBLIC_ERC6492_VALIDATOR", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "MAGIC_SPEND", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

const fail = (m) => {
  console.error(`STOP: ${m}`);
  process.exit(1);
};
if (!(await arc.getCode({ address: CREATE2_DEPLOYER }))) fail("no CREATE2 deployer on this chain");

let wallet = null;
if (broadcast) {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) fail("Set DEPLOYER_PRIVATE_KEY to deploy");
  const account = privateKeyToAccount(key);
  wallet = createWalletClient({ account, chain: { id: chainId, name: "arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
  console.log(`Deployer ${account.address}`);
}

for (const s of steps) {
  const address = getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt: SALT, bytecode: s.initCode });
  if (address.toLowerCase() !== EXPECTED[s.name].toLowerCase()) fail(`${s.name} would land at ${address}, not ${EXPECTED[s.name]}: the code differs from Base's`);
  const onBase = await base.getCode({ address });
  let onArc = await arc.getCode({ address });
  if (!onArc || onArc === "0x") {
    if (!broadcast) {
      console.log(`${s.name}: not deployed yet; would deploy at ${address}`);
      continue;
    }
    const hash = await wallet.sendTransaction({ to: CREATE2_DEPLOYER, data: concat([SALT, s.initCode]) });
    const receipt = await arc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") fail(`${s.name} deployment reverted (${hash})`);
    console.log(`${s.name}: deployed in ${hash}`);
    onArc = await arc.getCode({ address });
  }
  if (masked(onArc, s.name) !== masked(onBase, s.name)) fail(`${s.name} at ${address} on this chain is not the code on Base`);
  if (s.name === "SpendPermissionManager") {
    const [, name, version, domainChain, verifying] = await arc.readContract({ address, abi: MANAGER_ABI, functionName: "eip712Domain" });
    const validator = await arc.readContract({ address, abi: MANAGER_ABI, functionName: "PUBLIC_ERC6492_VALIDATOR" });
    const magic = await arc.readContract({ address, abi: MANAGER_ABI, functionName: "MAGIC_SPEND" });
    if (name !== "Spend Permission Manager" || version !== "1" || domainChain !== BigInt(chainId) || verifying.toLowerCase() !== address.toLowerCase()) fail(`unexpected EIP-712 domain ${name} v${version} chain ${domainChain} ${verifying}`);
    if (validator.toLowerCase() !== EXPECTED.PublicERC6492Validator.toLowerCase() || magic.toLowerCase() !== MAGIC_SPEND.toLowerCase()) fail("unexpected constructor arguments");
    console.log(`  EIP-712 domain: "${name}" v${version}, chain ${domainChain}, ${verifying} ✓`);
  }
  console.log(`${s.name}: ${address}, same code as Base ✓`);
}
console.log(broadcast ? "Done." : "Check passed.");
