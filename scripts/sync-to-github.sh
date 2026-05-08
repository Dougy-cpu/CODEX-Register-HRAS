#!/bin/bash
set -euo pipefail

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_TOKEN secret is not set."
  exit 1
fi

REMOTE_URL="https://Dougy-cpu:${GITHUB_TOKEN}@github.com/Dougy-cpu/CODEX-Register-HRAS.git"
TARGET_BRANCH="${TARGET_BRANCH:-main}"

echo "Syncing current committed state to GitHub branch: $TARGET_BRANCH"

PUSH_OUTPUT=$(git push "$REMOTE_URL" "HEAD:refs/heads/$TARGET_BRANCH" 2>&1) && {
  echo "$PUSH_OUTPUT"
  echo ""
  echo "Sync complete. Branch '$TARGET_BRANCH' on GitHub is up to date."
  echo "View at: https://github.com/Dougy-cpu/CODEX-Register-HRAS/tree/$TARGET_BRANCH"
  exit 0
}

echo "$PUSH_OUTPUT"

if echo "$PUSH_OUTPUT" | grep -qE "(non-fast-forward|fetch first|stale info)"; then
  echo ""
  echo "Non-fast-forward rejection detected."
  echo "Replit is the authoritative source — force-pushing to bring GitHub in sync."
  echo ""
  git push --force "$REMOTE_URL" "HEAD:refs/heads/$TARGET_BRANCH"
  echo ""
  echo "Sync complete (force push). Branch '$TARGET_BRANCH' on GitHub is up to date."
  echo "View at: https://github.com/Dougy-cpu/CODEX-Register-HRAS/tree/$TARGET_BRANCH"
else
  echo ""
  echo "ERROR: Push failed for a reason other than diverged history (see output above)."
  exit 1
fi
