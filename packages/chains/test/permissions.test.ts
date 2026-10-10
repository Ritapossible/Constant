import { encodeFunctionData, hashTypedData, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  SPEND_PERMISSION_MANAGER,
  SPEND_PERMISSION_MANAGER_ABI,
  addManagerCall,
  permissionFromJson,
  permissionToJson,
  spendPermissionTypedData,
  type SpendPermission,
} from "../src/index.js";

const p: SpendPermission = {
  account: "0x1111111111111111111111111111111111111111",
  spender: "0x2222222222222222222222222222222222222222",
  token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  allowance: 19_970_000n,
  period: 2_592_000,
  start: 1_794_650_000,
  end: 1_826_186_000,
  salt: 123456789n,
  extraData: "0x",
};

describe("spend permissions", () => {
  it("typed data matches the contract: domain, type string and field order", () => {
    const td = spendPermissionTypedData(p);
    expect(td.domain).toEqual({ name: "Spend Permission Manager", version: "1", chainId: 8453, verifyingContract: "0xf85210B21cC50302F477BA56686d2019dC9b67Ad" });
    const typeString = `SpendPermission(${td.types.SpendPermission.map((f) => `${f.type} ${f.name}`).join(",")})`;
    expect(typeString).toBe("SpendPermission(address account,address spender,address token,uint160 allowance,uint48 period,uint48 start,uint48 end,uint256 salt,bytes extraData)");
    expect(hashTypedData(td)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("an EOA signature over it can be checked (smart wallets use ERC-1271 / 6492 on chain)", async () => {
    const owner = privateKeyToAccount(keccak256(toHex("test owner")));
    const mine = { ...p, account: owner.address };
    const sig = await owner.signTypedData(spendPermissionTypedData(mine));
    const { recoverTypedDataAddress } = await import("viem");
    expect(await recoverTypedDataAddress({ ...spendPermissionTypedData(mine), signature: sig })).toBe(owner.address);
  });

  it("round-trips through JSON and rejects malformed input", () => {
    expect(permissionFromJson(permissionToJson(p))).toEqual(p);
    expect(() => permissionFromJson({ ...permissionToJson(p), allowance: "-1" })).toThrow();
    expect(() => permissionFromJson({ ...permissionToJson(p), allowance: (2n ** 160n).toString() })).toThrow();
    expect(() => permissionFromJson({ ...permissionToJson(p), period: 2 ** 48 })).toThrow();
    expect(() => permissionFromJson({ ...permissionToJson(p), account: "0x12" })).toThrow();
    expect(() => permissionFromJson({ ...permissionToJson(p), extraData: "0xz" })).toThrow();
  });

  it("encodes the calls the contract expects", () => {
    const spend = encodeFunctionData({ abi: SPEND_PERMISSION_MANAGER_ABI, functionName: "spend", args: [p, 1_000_000n] });
    expect(spend.slice(0, 10)).toMatch(/^0x[0-9a-f]{8}$/);
    const call = addManagerCall(p.account);
    expect(call.to).toBe(p.account);
    expect(call.data.toLowerCase()).toContain(SPEND_PERMISSION_MANAGER.slice(2).toLowerCase());
    expect(SPEND_PERMISSION_MANAGER_ABI.map((x) => ("name" in x ? x.name : "")).sort()).toEqual(
      ["approveWithSignature", "getCurrentPeriod", "getHash", "isApproved", "isRevoked", "isValid", "revoke", "revokeAsSpender", "spend"].sort(),
    );
    void (null as unknown as Hex);
  });
});
