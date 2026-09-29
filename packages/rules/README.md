# @constant/rules

Pure functions. The only code that decides buy or do-not-buy. No I/O: no clock, no env, no network, no database. Callers pass `now`.

| Module | Decides |
|---|---|
| `schedule.ts` | `decideSchedule` (buy / do-not-buy with reason), `scanAction` (vend / advance / notify / hold), `effectiveWeeklyCap` |
| `time.ts` | Next run, next run after a buy (respecting the gap), week start, all in the site's time zone |
| `alert.ts` | `parseUnits`, `decideAlert`. Alert mode never produces an amount. |
| `commands.ts` | `parseCommand`, `routeInbound`: who may send what |
| `order.ts` | Order state machine, crash recovery, when the ledger is debited |
| `money.ts` | Funding credit, reversal, price check, reconciliation |
| `keys.ts` | Idempotency keys for orders, ledger entries and notices |

Amounts are `bigint` minor units. Tests are named after `docs/INVARIANTS.md`.

```sh
pnpm --filter @constant/rules test
```
