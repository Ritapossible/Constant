/**
 * A small Merkle tree for receipt anchoring. Leaves and nodes are SHA-256; pairs are sorted before
 * hashing, so a proof is a plain list of sibling hashes and anyone can check it with a few lines of code.
 * Leaves are domain-separated from nodes (0x00 / 0x01 prefix) so a node can never pass as a leaf.
 */
import { createHash } from "node:crypto";

const sha256 = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();

export function leafHash(data: string): string {
  return sha256(Buffer.from([0]), Buffer.from(data, "utf8")).toString("hex");
}

function node(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return sha256(Buffer.from([1]), Buffer.from(x, "hex"), Buffer.from(y, "hex")).toString("hex");
}

/** Root and one proof per leaf, in the order given. An odd node is carried up unchanged. */
export function merkle(leaves: readonly string[]): { root: string; proofs: string[][] } {
  if (leaves.length === 0) throw new Error("merkle: no leaves");
  const proofs: string[][] = leaves.map(() => []);
  let level = leaves.map((h, i) => ({ h, members: [i] }));
  while (level.length > 1) {
    const next: typeof level = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1];
      if (!b) {
        next.push(a);
        continue;
      }
      for (const m of a.members) proofs[m]!.push(b.h);
      for (const m of b.members) proofs[m]!.push(a.h);
      next.push({ h: node(a.h, b.h), members: [...a.members, ...b.members] });
    }
    level = next;
  }
  return { root: level[0]!.h, proofs };
}

export function verifyProof(leaf: string, proof: readonly string[], root: string): boolean {
  return proof.reduce((acc, sib) => node(acc, sib), leaf) === root;
}
