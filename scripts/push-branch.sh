#!/bin/bash
set -euo pipefail

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: GITHUB_TOKEN secret is not set."
  exit 1
fi

BRANCH_NAME="${1:-sync/$(date +%Y-%m-%d-%H%M%S)}"
REMOTE_URL="https://Dougy-cpu:${GITHUB_TOKEN}@github.com/Dougy-cpu/CODEX-Register-HRAS.git"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: There are uncommitted changes."
  echo "Commit your changes first, then run this script again."
  exit 1
fi

echo "Pushing current committed state to branch: $BRANCH_NAME"
git push "$REMOTE_URL" "HEAD:refs/heads/$BRANCH_NAME"

echo ""
echo "Branch pushed: $BRANCH_NAME"
echo "Open a PR at: https://github.com/Dougy-cpu/CODEX-Register-HRAS/compare/$BRANCH_NAME"
echo ""
echo "To open a PR from this branch, run:"
echo "  BRANCH_NAME=\"$BRANCH_NAME\" bash scripts/create-pr.sh"
