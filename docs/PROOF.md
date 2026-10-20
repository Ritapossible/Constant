# The sandbox proof (before any live key)

From the 2026-10-20 review. Pxxl with sandbox keys is a test bench, not a launch: no backups on the free plan, and a
worker that may sleep makes a renewal late. Keep `vending_enabled` **off** except during step 4.

Run it on your own phone, then have someone who isn't you do steps 1 to 4 on theirs.

| # | Step | Pass when |
|---|---|---|
| 1 | Sign in. Open **Money**. | A Paystack **test** account number shows. |
| 2 | Simulate a transfer to it (Paystack test dashboard), then **resend the same webhook** from the dashboard. | The balance rises **once**; the replay shows `duplicate`; a "funded" message arrives. |
| 3 | **Bills → Cable → DStv**, smartcard `1212121212`. | A customer name **and a renewal price** come back. If there's no price, stop: ConstantUnits never guesses a bouquet price (no quote, no payment). |
| 4 | Turn vending on (below), then in Neon's SQL editor make the line due: `UPDATE lines SET next_run_at = now() WHERE nickname = '…';` | Within 5 minutes: the balance drops **once** (amount + fee, or amount only on the account's first payment), the order is `settled`, and a message arrives (Telegram, or email once Resend is on). |
| 5 | Repeat with VTpass's sandbox **failure** number for that service. | The balance doesn't move; the bill shows it wasn't paid; a "not paid" message arrives. |
| 6 | `DATABASE_URL=… scripts/backup-db.sh` | The script lists the tables and writes an encrypted `.gpg` file. Then turn vending **off** again. |

Vending on and off (needs `OPS_TOKEN` set on the API, 32+ characters):

```
curl -X POST https://constant.pxxlspace.cv/ops/flags/vending_enabled \
  -H "authorization: Bearer $OPS_TOKEN" -H "x-ops-actor: your-name" -H "content-type: application/json" \
  -d '{"value": true, "note": "sandbox proof step 4"}'
```

Send `"value": false` to switch it off again.

Only after all six pass for two people: move the same database to a host with backups (Pxxl Pro or Render with
Neon's paid plan), paste the live keys, fund the VTpass wallet, and repeat step 4 with your own decoder and naira.
The **Preview** badge goes away only after that live step 4, when `vending_enabled` is left on.

Messages: with `MESSAGING_PROVIDER=fake`, email and SMS are only logged. Telegram works without an email domain
(PXXL.md "Telegram"), so use it for steps 2 to 5 until Resend is set up.
