# ConstantMandate (QIE)

Capped, revocable bill mandates in one stablecoin, for ConstantUnits on QIE (decision D-072; plan in
`docs/HACKATHON.md`; design in `docs/ARCHITECTURE.md`, "QIE").

A user deposits the stablecoin and opens a line per bill: who may charge it (ConstantUnits's server address), how
much per period, and the period length. The spender charges a line only within this period's allowance and the user's
balance, and each order id only once. Charges go to a treasury fixed at deploy. The user can withdraw or revoke at any
time, even while charges are paused. The owner can pause and unpause charges, and nothing else.

| File | What |
|---|---|
| `src/ConstantMandate.sol` | The contract (Solidity 0.8.24, OpenZeppelin 5.4: SafeERC20, Ownable2Step, Pausable, ReentrancyGuard) |
| `src/TestStable.sol` | tUSD, a worthless 6-decimal token with an open faucet, for testnet and local runs. Refuses chain 1990. |
| `test/ConstantMandate.t.sol` | Unit tests for every rule, fuzzing of amounts and periods |
| `test/ConstantMandate.invariant.t.sol` | Invariants through a handler that also attacks as the owner and a stranger |
| `script/Deploy.s.sol` | Deploy on 1983, 1990 or local only; mainnet needs the official stablecoin in `addresses.json` |
| `addresses.json` | Deployed addresses per chain. Mainnet's stablecoin is filled only from the QIE team, with proof. |
| `../../scripts/qie/proof-testnet.mjs` | Runs every rule on a live chain with fresh accounts (15 checks) |

## Test

```sh
git submodule update --init contracts/qie/lib/forge-std contracts/qie/lib/openzeppelin-contracts
cd contracts/qie
forge test                      # 40 tests: 35 unit + fuzz (1,000 runs), 5 invariants (256 × 64 calls)
FOUNDRY_PROFILE=ci forge test   # what CI runs: 5,000 fuzz runs, 512 × 128 invariant calls
```

What must fail the build (HACKATHON.md), and the test that guards it:

| Must never happen | Test |
|---|---|
| The spender charges over the cap | `test_charge_overAllowanceReverts`, `testFuzz_charges_neverExceedAllowancePerWindow`, `invariant_noForbiddenCharge` |
| A second caller charges | `test_charge_onlyTheLinesSpender` |
| A revoked line charges | `test_revoke_emitsAndStopsCharges`, `invariant_noForbiddenCharge` |
| The same order is charged twice | `test_charge_sameOrderOnlyOnce_evenOnAnotherLineOrPeriod`, `invariant_noForbiddenCharge` |
| The owner moves a user's balance | `test_owner_cannotMoveBalances`, `invariant_ownerAndStrangerTakeNothing`, `invariant_balancesMatchLedger` |
| Pause blocks a withdrawal | `test_withdraw_worksWhilePaused` |
| The contract holds less than the sum of balances | `invariant_holdsEveryBalance` |

Each rule was also broken on purpose (no cap check, no spender check, no order check, charges ignoring pause, no
revoke check, withdrawals blocked by pause); every one of the six made tests fail.

## Deploy to QIE testnet (chain 1983)

1. A deployer key with testnet QIE from the [faucet](https://www.qie.digital/faucet). Keep the key out of the repo.
2. Deploy (TestStable is deployed too, as the stablecoin):

   ```sh
   cd contracts/qie
   QIE_TREASURY=0x… QIE_OWNER=0x… forge script script/Deploy.s.sol \
     --rpc-url qie_testnet --broadcast --private-key $QIE_DEPLOYER_KEY
   ```

3. Verify the source on [testnet.qie.digital](https://testnet.qie.digital/) (Blockscout):

   ```sh
   forge verify-contract <mandate> src/ConstantMandate.sol:ConstantMandate --chain 1983 \
     --verifier blockscout --verifier-url https://testnet.qie.digital/api/ \
     --constructor-args $(cast abi-encode "f(address,address,address)" <token> <treasury> <owner>)
   ```

4. Prove it on chain, then copy the addresses into `addresses.json`:

   ```sh
   QIE_RPC=https://rpc2testnet.qie.digital/ QIE_DEPLOYER_KEY=0x… QIE_MANDATE=0x… node scripts/qie/proof-testnet.mjs
   ```

   (The deployer must be the owner for the pause checks.) RPCs 2, 4, 5 and 6 answered on 2026-10-16; rpc1 and rpc3
   did not.

## Mainnet (chain 1990)

Not before: the QIE team confirms the stablecoin (recorded in `addresses.json` with its proof), a security review of
the contract and the worker path, the owner is a multisig, and the testnet proof has passed. The deploy script
refuses mainnet without the recorded stablecoin, and refuses a token whose code, symbol or decimals don't match.
