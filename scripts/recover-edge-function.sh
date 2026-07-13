#!/usr/bin/env bash
set -euo pipefail

# Recover a deployed Supabase Edge Function into this repository, verify the
# recovered source, commit it, and update RECOVERY_MANIFEST.md.
#
# Required:
#   supabase CLI authenticated for the target project
#   git working tree on the branch to update
#
# Usage:
#   bash scripts/recover-edge-function.sh <function-slug> [expected-byte-checksum]
#
# The optional checksum is this executor's deterministic byte checksum, not the
# externally supplied ezbr_sha256 unless that producer uses the same algorithm.
# The executor always verifies downloaded bytes against repository bytes.
#
# Environment overrides:
#   SUPABASE_PROJECT_REF   default: balkvbmtummehgbbeqap
#   SKIP_MANIFEST_UPDATE  set to 1 to omit manifest update

PROJECT_REF="${SUPABASE_PROJECT_REF:-balkvbmtummehgbbeqap}"
SLUG="${1:-}"
EXPECTED_CHECKSUM="${2:-}"
SKIP_MANIFEST_UPDATE="${SKIP_MANIFEST_UPDATE:-0}"

if [[ -z "$SLUG" ]]; then
  echo "Usage: bash $0 <function-slug> [expected-byte-checksum]" >&2
  exit 2
fi

for command in git supabase python3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 2
  }
done

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean before recovery." >&2
  exit 2
fi

# Discover the installed CLI contract instead of assuming an obsolete command.
if ! supabase functions download --help >/dev/null 2>&1; then
  echo "Installed Supabase CLI does not support 'functions download'. Upgrade the CLI." >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

DOWNLOAD_ROOT="$TMP_ROOT/download"
mkdir -p "$DOWNLOAD_ROOT"

# Supabase writes the downloaded function below supabase/functions/<slug>.
(
  cd "$DOWNLOAD_ROOT"
  supabase functions download "$SLUG" --project-ref "$PROJECT_REF"
)

SOURCE_DIR="$DOWNLOAD_ROOT/supabase/functions/$SLUG"
if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Downloaded source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

TARGET_DIR="$REPO_ROOT/edge-functions/$SLUG"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -a "$SOURCE_DIR"/. "$TARGET_DIR"/

checksum_dir() {
  python3 - "$1" <<'PY'
from pathlib import Path
import hashlib
import sys

root = Path(sys.argv[1])
h = hashlib.sha256()
for path in sorted(p for p in root.rglob('*') if p.is_file()):
    rel = path.relative_to(root).as_posix().encode('utf-8')
    data = path.read_bytes()
    h.update(rel)
    h.update(b'\0')
    h.update(str(len(data)).encode('ascii'))
    h.update(b'\0')
    h.update(data)
print(h.hexdigest())
PY
}

# Deterministic checksum detects missing, extra, changed, and empty files without
# normalizing line endings.
SOURCE_CHECKSUM="$(checksum_dir "$SOURCE_DIR")"
TARGET_CHECKSUM="$(checksum_dir "$TARGET_DIR")"

if [[ "$TARGET_CHECKSUM" != "$SOURCE_CHECKSUM" ]]; then
  echo "Downloaded source and repository copy differ." >&2
  echo "Source: $SOURCE_CHECKSUM" >&2
  echo "Target: $TARGET_CHECKSUM" >&2
  exit 1
fi

if [[ -n "$EXPECTED_CHECKSUM" && "$TARGET_CHECKSUM" != "$EXPECTED_CHECKSUM" ]]; then
  echo "Expected byte checksum mismatch for $SLUG" >&2
  echo "Expected: $EXPECTED_CHECKSUM" >&2
  echo "Actual:   $TARGET_CHECKSUM" >&2
  exit 1
fi

FILE_COUNT="$(find "$TARGET_DIR" -type f | wc -l | tr -d ' ')"
EMPTY_COUNT="$(find "$TARGET_DIR" -type f -size 0 | wc -l | tr -d ' ')"

git add -- "edge-functions/$SLUG"
git commit -m "Recover $SLUG from production" \
  -m "Source downloaded directly from Supabase project $PROJECT_REF." \
  -m "$FILE_COUNT files ($EMPTY_COUNT empty). PF-1A recovery -- no modifications, no refactoring." \
  -m "Byte checksum: $TARGET_CHECKSUM"
RECOVERY_COMMIT="$(git rev-parse HEAD)"

if [[ "$SKIP_MANIFEST_UPDATE" != "1" ]]; then
  python3 - "$SLUG" "$RECOVERY_COMMIT" <<'PY'
from pathlib import Path
import re
import sys

slug, commit = sys.argv[1:]
path = Path('RECOVERY_MANIFEST.md')
text = path.read_text(encoding='utf-8')
pattern = re.compile(rf'^\| {re.escape(slug)} \| .*$', re.MULTILINE)
replacement = f'| {slug} | Complete | Yes | {commit} |'
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'Manifest row not found or ambiguous for {slug}')

summary = re.search(r'(?m)^Complete: (\d+)$', text)
if not summary:
    raise SystemExit('Manifest Complete count not found')
current = int(summary.group(1))
text = text[:summary.start(1)] + str(current + 1) + text[summary.end(1):]
path.write_text(text, encoding='utf-8')
PY

  git add RECOVERY_MANIFEST.md
  git commit -m "Mark $SLUG recovered and verified"
fi

# Verify the committed tree contains exactly the bytes that were downloaded.
COMMITTED_TMP="$TMP_ROOT/committed"
mkdir -p "$COMMITTED_TMP"
git archive HEAD "edge-functions/$SLUG" | tar -x -C "$COMMITTED_TMP"
COMMITTED_CHECKSUM="$(checksum_dir "$COMMITTED_TMP/edge-functions/$SLUG")"
if [[ "$COMMITTED_CHECKSUM" != "$SOURCE_CHECKSUM" ]]; then
  echo "Committed source verification failed." >&2
  echo "Downloaded: $SOURCE_CHECKSUM" >&2
  echo "Committed:  $COMMITTED_CHECKSUM" >&2
  exit 1
fi

git diff --exit-code HEAD -- "edge-functions/$SLUG" RECOVERY_MANIFEST.md

echo "Recovered: $SLUG"
echo "Files: $FILE_COUNT ($EMPTY_COUNT empty)"
echo "Byte checksum: $TARGET_CHECKSUM"
echo "Recovery commit: $RECOVERY_COMMIT"
echo "Final commit: $(git rev-parse HEAD)"
