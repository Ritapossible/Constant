# Operations

A money product is mostly operations. This is the runbook skeleton. Fill it in as each step of `PLAN.md` ships.

## On-call pages

| Page | Meaning | First action |
|---|---|---|
| `needs_human` order | We cannot prove whether the partner took money for this order. The site is frozen. | Look up the order at the partner by our order id and the time window. Resolve as `resolved_token` (store token, notify) or `resolved_failed` (refund entry). Unfreeze. Never re-vend to find out. |
| `vending` older than 60 min | Partner has not settled. | Check partner status page. Run `fetch(partnerRef)`. Tell the owner if it passes 2 hours. Do not refund while pending. |
| `vending_enabled = false` | Reconciliation found a mismatch. Nobody is buying. | Read the mismatch list. Fix the books with an `adjust` entry signed by two people, rerun reconciliation, clear the flag. |
| Scan missed 5 minutes | Worker is down. | Restart. Runs on the same local day still go through; older ones are reported to owners as missed (D-006). |
| SMS failures above threshold | Provider or sender ID problem. | Switch to the secondary SMS provider. Tokens are resent from storage, never re-bought. |

## Daily

- Reconciliation report (automatic at 02:00 local, manual button for incidents).
- Oldest pending vend, `needs_human` count, funding reversals.

## Customer support

Support reads Postgres, not the chain and not logs. For any complaint, find the site by owner phone, then:
`orders` (state, times) → `order_events` (history) → `order_tokens` (token last 4, received_at) → `notices` (what we told them) → `ledger_entries` (money).

Resending a token: re-send the stored token to the site phone. Never buy again for a lost SMS.

## Hosting and data

- Managed Postgres with point-in-time recovery; daily restore test once live.
- Region chosen with data-protection transfer rules in mind (Nigeria's NDPA; each new market's equivalent). Record the choice in `DECISIONS.md` before the first real customer.
- Secrets in the platform's secret store. Keys rotated with key ids on ciphertexts.

## The operator API (D-065)

All calls need `Authorization: Bearer $OPS_TOKEN`; every write also needs `x-ops-actor: <your name>` and a `note`.

```bash
API=https://<constant-api>.onrender.com
H=(-H "authorization: Bearer $OPS_TOKEN" -H "x-ops-actor: rita" -H "content-type: application/json")

curl "${H[@]}" $API/ops/summary                       # switches, orders by state, open alerts, last reconciliation
curl "${H[@]}" $API/ops/alerts                        # open alerts
curl "${H[@]}" -X POST $API/ops/alerts/12/resolve -d '{"note":"float topped up"}'
curl "${H[@]}" $API/ops/orders/needs-human            # what's waiting for a person

# After checking the VTpass dashboard for that request id:
curl "${H[@]}" -X POST $API/ops/orders/<id>/resolve -d '{"outcome":"delivered","note":"VTpass shows delivered 07:02"}'
curl "${H[@]}" -X POST $API/ops/orders/<id>/resolve -d '{"outcome":"not_delivered","note":"VTpass has no such request"}'
# A dollar charge nobody could confirm: check the tx on Basescan first.
curl "${H[@]}" -X POST $API/ops/orders/<id>/resolve -d '{"charged":true,"note":"tx 0x… succeeded"}'

curl "${H[@]}" -X POST $API/ops/lines/<id>/unfreeze -d '{"note":"…"}'
curl "${H[@]}" -X POST $API/ops/users/<id>/unfreeze -d '{"note":"compliance review #…","screeningCleared":true}'
curl "${H[@]}" -X POST $API/ops/flags/vending_enabled -d '{"value":true,"note":"sandbox checks passed"}'
curl "${H[@]}" -X POST $API/ops/reconcile -d '{}'     # runs within a minute
```

Switches: `vending_enabled` (all bill payments), `dollar_charges_enabled` (USDC charges; trips at the daily limit), `payouts_enabled` (withdrawals; off until Paystack's letter). Reconciliation turns all three off on a mismatch: find the cause in `reconciliation_runs.mismatches`, fix it, then switch them back on with a note.
