#!/bin/bash
set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN secret is not set. Please add it in Replit Secrets."
  exit 1
fi

REMOTE_URL="https://Dougy-cpu:${GITHUB_TOKEN}@github.com/Dougy-cpu/CODEX-Register-HRAS.git"

echo "Pushing to GitHub (CODEX-Register-HRAS)..."

GIT_AUTHOR_NAME="Replit Sync" \
GIT_AUTHOR_EMAIL="replit-sync@noreply.github.com" \
GIT_COMMITTER_NAME="Replit Sync" \
GIT_COMMITTER_EMAIL="replit-sync@noreply.github.com" \
git push "$REMOTE_URL" main --force

echo "Sync complete at $(date)."
