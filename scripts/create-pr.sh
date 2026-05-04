#!/bin/bash
set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN secret is not set."
  exit 1
fi

BRANCH_NAME="${BRANCH_NAME:-${1:-}}"
if [ -z "$BRANCH_NAME" ]; then
  echo "Usage: BRANCH_NAME=sync/my-branch bash scripts/create-pr.sh"
  echo "  or:  bash scripts/create-pr.sh sync/my-branch"
  exit 1
fi

PR_TITLE="${PR_TITLE:-"Sync: $BRANCH_NAME"}"
PR_BODY="${PR_BODY:-"Automated sync from Replit workspace on $(date '+%Y-%m-%d %H:%M UTC')."}"
BASE_BRANCH="${BASE_BRANCH:-main}"
REPO="Dougy-cpu/CODEX-Register-HRAS"

echo "Creating PR: '$PR_TITLE'"
echo "  Branch: $BRANCH_NAME → $BASE_BRANCH"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO/pulls" \
  -d "$(jq -n \
    --arg title "$PR_TITLE" \
    --arg body "$PR_BODY" \
    --arg head "$BRANCH_NAME" \
    --arg base "$BASE_BRANCH" \
    '{title: $title, body: $body, head: $head, base: $base}'
  )")

HTTP_STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_STATUS" = "201" ]; then
  PR_URL=$(echo "$BODY" | grep -o '"html_url":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo ""
  echo "PR created successfully!"
  echo "  $PR_URL"
else
  echo "Failed to create PR (HTTP $HTTP_STATUS):"
  echo "$BODY" | grep -o '"message":"[^"]*"' | head -1
  exit 1
fi
