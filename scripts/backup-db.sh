#!/usr/bin/env bash
# Backs up the ConstantUnits database to backups/, checks the copy can be read, and encrypts it.
#
#   DATABASE_URL='postgresql://…' scripts/backup-db.sh
#
# The file holds personal data (emails, encrypted bill numbers). It is encrypted with a passphrase you choose: keep
# that passphrase, REF_ENCRYPTION_KEY and REF_HMAC_KEY in your password manager. Without the two keys, bill numbers in
# a restored copy can't be read. Never commit or email the file. Needs pg_dump 16+ and gpg.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL (the direct, unpooled connection string)}"
cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date -u +%Y%m%d-%H%M)
file="backups/constantunits-$stamp.dump"

pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$file"

# Prove the copy is readable before trusting it: list its contents and count the money tables.
pg_restore --list "$file" >/dev/null
for t in users lines orders ledger_entries funding_events; do
  printf '%-16s %s\n' "$t" "$(pg_restore --list "$file" | grep -c "TABLE DATA public $t " || true) table"
done
echo "rows now: $(psql "$DATABASE_URL" -Atc "SELECT 'users=' || (SELECT count(*) FROM users) || ' orders=' || (SELECT count(*) FROM orders) || ' ledger=' || (SELECT count(*) FROM ledger_entries)")"

gpg --symmetric --cipher-algo AES256 --output "$file.gpg" "$file"
shred -u "$file" 2>/dev/null || rm -f "$file"
echo "Encrypted backup: $file.gpg"
echo "Restore: gpg -d $file.gpg > restore.dump && pg_restore --no-owner --dbname=\"\$NEW_DATABASE_URL\" restore.dump"
