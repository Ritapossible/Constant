#!/usr/bin/env bash
# Cheap CI guard. Fails the build on:
#  1. Words a customer must never see, inside user-facing copy.
#  2. Things that look like committed secrets.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# 1. User-facing copy lives in packages/copy/src (see docs/UX.md).
if [ -d packages/copy/src ]; then
  if grep -rniE '\b(usdc|xlm|stellar|soroban|crypto|blockchain|wallet|seed|gas fee)\b|\$[0-9]|\bUSD\b|dollar' \
      packages/copy/src --include='*.ts' | grep -v '\.test\.ts:'; then
    echo "guard: banned word in user-facing copy" >&2
    fail=1
  fi
fi

# 2. Secrets. Keys belong in the environment, never the repo.
if git grep -nIE '(sk_live_|-----BEGIN (RSA |EC )?PRIVATE KEY-----|S[A-Z2-7]{55}\b)' -- ':!scripts/guard.sh' ':!*.md'; then
  echo "guard: possible secret committed" >&2
  fail=1
fi

exit $fail
