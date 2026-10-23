# Mandate contract (Soroban)

One mandate per bill: ConstantUnits may take up to a cap of USDC per period from the owner's Stellar account, until an
end date, straight to the treasury. The owner signs once; the operator charges; the owner or the operator can revoke.
Why and how: docs/DECISIONS.md D-085. Invariants 96–99.

| Function | Who signs | What |
|---|---|---|
| `__constructor(admin, treasury, token)` | (deploy) | the operator, where USDC goes, the USDC contract |
| `create(owner, id, cap, period, end, expiry_ledger)` | owner | records the mandate; approves the contract for what live mandates may take, summed |
| `charge(id, charge_id, amount)` | admin | within this period's cap; once per `charge_id`; transfers to the treasury |
| `revoke(caller, id)` | owner or admin | stops it for good; the owner's revoke lowers the allowance too |
| `get`, `remaining`, `outstanding`, `admin`, `treasury`, `token` | — | views |
| `set_admin`, `set_treasury`, `upgrade` | admin | |

Errors: 1 MandateExists, 2 MandateNotFound, 3 InvalidAmount, 4 InvalidPeriod, 5 Revoked, 6 Expired, 7 OverCap,
8 DuplicateCharge, 9 NotAllowed, 10 BadExpiry.

```sh
cargo test                       # 14 tests
stellar contract build           # stellar-cli 25.2+; soroban-sdk 29 refuses plain cargo builds
cp target/wasm32v1-none/release/constant_mandate.wasm .   # the committed build the scripts deploy
node ../../scripts/stellar/deploy.mjs                      # testnet: makes and funds keys, prints the env
```

`constant_mandate.wasm` is committed so the deploy and proof scripts need no Rust toolchain. Its sha256 is printed on
deploy; rebuild it whenever `src/` changes.
