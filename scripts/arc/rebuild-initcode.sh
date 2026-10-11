#!/usr/bin/env bash
# Reproduces spend-permissions-initcode.json from Coinbase's source (D-070). Needs git, jq, python3 and Foundry.
# 1. Builds coinbase/spend-permissions at tag v1.0.0 with solc 0.8.28 and the repo's deploy profile.
# 2. Checks the runtime code equals the contracts live on Base (immutables and metadata aside).
# 3. Puts Base's metadata into the creation code, so CREATE2 gives Base's exact addresses.
# Last run 2026-10-11: both contracts identical; addresses 0xcfCE48B7…293D and 0xf85210B2…67Ad.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
base_rpc="${BASE_RPC_URL:-https://mainnet.base.org}"
git clone -q https://github.com/coinbase/spend-permissions.git "$work/sp"
cd "$work/sp"
git checkout -q v1.0.0
git config submodule.lib/magic-spend.url https://github.com/coinbase/MagicSpend.git # renamed upstream
git submodule update -q --init --recursive
FOUNDRY_PROFILE=deploy forge build --use 0.8.28 --contracts src >/dev/null
for a in 0xcfCE48B757601F3f351CB6f434CB0517aEEE293D 0xf85210B21cC50302F477BA56686d2019dC9b67Ad; do
  cast code "$a" -r "$base_rpc" > "$work/code_$a.hex"
done
python3 -I - "$work" "$here/spend-permissions-initcode.json" <<'EOF'
import json, sys
work, dest = sys.argv[1], sys.argv[2]
def split(h):
    h = h.lower().removeprefix("0x"); n = int(h[-4:], 16); return h[:-(n + 2) * 2], h[-(n + 2) * 2:]
out = {"immutableReferences": {}}
for name, addr in [("PublicERC6492Validator", "0xcfCE48B757601F3f351CB6f434CB0517aEEE293D"), ("SpendPermissionManager", "0xf85210B21cC50302F477BA56686d2019dC9b67Ad")]:
    j = json.load(open(f"out/{name}.sol/{name}.json"))
    mine, mine_meta = split(j["deployedBytecode"]["object"])
    theirs, theirs_meta = split(open(f"{work}/code_{addr}.hex").read().strip())
    m, t = list(mine), list(theirs)
    for refs in j["deployedBytecode"].get("immutableReferences", {}).values():
        for r in refs:
            s, e = r["start"] * 2, (r["start"] + r["length"]) * 2
            m[s:e] = t[s:e] = "0" * (e - s)
    if m != t:
        sys.exit(f"{name}: runtime code differs from Base")
    init = j["bytecode"]["object"].lower().removeprefix("0x")
    assert init.count(mine_meta) == 1
    out[name] = "0x" + init.replace(mine_meta, theirs_meta)
    refs = sorted({(r["start"], r["length"]) for v in j["deployedBytecode"].get("immutableReferences", {}).values() for r in v})
    out["immutableReferences"][name] = [{"start": s, "length": l} for s, l in refs]
    print(f"{name}: identical to Base")
json.dump(out, open(dest, "w"))
EOF
rm -rf "$work"
echo "Wrote $here/spend-permissions-initcode.json"
