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
