#!/bin/bash
set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN secret is not set."
  exit 1
fi

BRANCH_NAME="${1:-sync/$(date +%Y-%m-%d-%H%M%S)}"
REMOTE_URL="https://Dougy-cpu:${GITHUB_TOKEN}@github.com/Dougy-cpu/CODEX-Register-HRAS.git"

echo "Pushing current state to branch: $BRANCH_NAME"

GIT_AUTHOR_NAME="Replit Sync" \
GIT_AUTHOR_EMAIL="replit-sync@noreply.github.com" \
GIT_COMMITTER_NAME="Replit Sync" \
GIT_COMMITTER_EMAIL="replit-sync@noreply.github.com" \
git push "$REMOTE_URL" "HEAD:refs/heads/$BRANCH_NAME"

echo ""
echo "Branch pushed: $BRANCH_NAME"
echo "Open a PR at: https://github.com/Dougy-cpu/CODEX-Register-HRAS/compare/$BRANCH_NAME"
echo ""
echo "To open a PR from this branch, run:"
echo "  BRANCH_NAME=\"$BRANCH_NAME\" bash scripts/create-pr.sh"
