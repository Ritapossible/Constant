# worker

The only process that spends money. One loop each for:

- **Renewal scan** (every 5 min): cable lines whose `next_run_at` is due. Fresh price from the partner, then `decideRenewal` under the user's row lock. Creates at most one order per line.
- **Orders** (every 10 s): `ready` → save the partner request id → call the partner. `vending` → requery on a back-off (1, 2, 5, 10, 20, 30 min), then a person.
- **Notices** (every 10 s): email first, SMS if no email. A renewal's order settles once the user is told (or the message finally fails).
- **Recovery** on start: every order caught in `vending` is requeried, never re-sent.

The orders and notices tables are the queues (`FOR UPDATE SKIP LOCKED`), so creating an order and queueing it is one transaction (D-058).

Vending starts **off** (`system_flags.vending_enabled = false`). Turn it on after the sandbox checks:

```sql
UPDATE system_flags SET value = true, changed_by = '<you>', reason = 'sandbox checks passed', changed_at = now() WHERE key = 'vending_enabled';
```

The worker turns it off itself if the partner says our balance is empty, and pages via `ops_alerts`.
