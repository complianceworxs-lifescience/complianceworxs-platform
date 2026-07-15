#!/usr/bin/env bash
# M7-01 (CI entrypoint) — wraps `npm run verify` for CI.
#
# ADVISORY in Milestone 7 (DR §14 rollout step 2): this reports the verification result
# but does not, by itself, enforce a merge block — CI *enforcement* is out of scope for
# M7 (§6.8-adjacent). It auto-selects gates from the PR diff against the base ref.
#
# Usage:  scripts/ci-verify.sh [base_ref]   (default base: origin/main)
set -uo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-origin/main}"
echo "ci-verify: selecting gates from diff against ${BASE}"

# Prefer a real diff against the base; fall back to HEAD~1 if the base is unavailable.
if git rev-parse --verify --quiet "${BASE}" >/dev/null; then
  DIFF_BASE="${BASE}"
else
  echo "ci-verify: base ${BASE} not found; falling back to HEAD~1"
  DIFF_BASE="HEAD~1"
fi

node --experimental-strip-types verification/verify.js --base "${DIFF_BASE}" --json
STATUS=$?

if [ "${STATUS}" -ne 0 ]; then
  echo "ci-verify: verification reported FAIL (advisory in M7)"
else
  echo "ci-verify: verification PASS"
fi
exit "${STATUS}"
