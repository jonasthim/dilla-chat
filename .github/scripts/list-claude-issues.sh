#!/bin/bash
#
# list-claude-issues.sh
# Lists issues that were built or fixed by Claude (via auto-fix workflow or direct Claude Code intervention)
#
# Usage:
#   ./list-claude-issues.sh [--state open|closed|all] [--format json|text]
#
# Examples:
#   ./list-claude-issues.sh                    # List all open Claude-related issues
#   ./list-claude-issues.sh --state closed     # List closed issues
#   ./list-claude-issues.sh --format json      # Output as JSON

set -euo pipefail

# Default values
STATE="open"
FORMAT="text"
REPO="${GITHUB_REPOSITORY:-dilla-chat/dilla-chat}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --state)
      STATE="$2"
      shift 2
      ;;
    --format)
      FORMAT="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--state open|closed|all] [--format json|text]"
      echo ""
      echo "Lists issues that were built or fixed by Claude"
      echo ""
      echo "Options:"
      echo "  --state   Filter by issue state (open, closed, all). Default: open"
      echo "  --format  Output format (json, text). Default: text"
      echo "  --help    Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Check if gh is installed
if ! command -v gh &> /dev/null; then
  echo "Error: GitHub CLI (gh) is not installed." >&2
  echo "Install it from: https://cli.github.com/" >&2
  exit 1
fi

# Function to get auto-fix issues (created by github-actions)
get_autofix_issues() {
  local state=$1
  gh issue list \
    --repo "$REPO" \
    --state "$state" \
    --label "auto-fix" \
    --json number,title,state,labels,createdAt,closedAt,url \
    --jq '.[] | select(.labels | any(.name == "auto-fix"))'
  return 0
}

# Function to get PRs created by Claude
get_claude_prs() {
  local state=$1
  gh pr list \
    --repo "$REPO" \
    --state "$state" \
    --author "Claude" \
    --json number,title,state,url,mergedAt,closedAt,body \
    --jq '.[]'
  return 0
}

# Function to extract issue numbers from PR body
extract_fixed_issues() {
  local pr_body=$1
  # Look for patterns like "Closes #123", "Fixes #123", "Resolves #123"
  echo "$pr_body" | grep -oP '(?:Closes?|Fixes?|Resolves?) #\K\d+' || true
  return 0
}

SEPARATOR_HEAVY="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
SEPARATOR_LIGHT="================================================================"
LABEL_AUTO_FIX="auto-fix"
AUTHOR_CLAUDE="Claude"
JQ_LENGTH="length"

if [[ "$FORMAT" == "json" ]]; then
  # JSON output
  echo "{"

  # Auto-fix issues
  echo '  "autofix_issues": ['
  if [[ "$STATE" == "all" ]]; then
    (get_autofix_issues "open"; get_autofix_issues "closed") | jq -s '.'
  else
    get_autofix_issues "$STATE" | jq -s '.'
  fi
  echo "  ],"

  # Claude PRs
  echo '  "claude_prs": ['
  if [[ "$STATE" == "all" ]]; then
    (get_claude_prs "open"; get_claude_prs "closed") | jq -s '.'
  else
    get_claude_prs "$STATE" | jq -s '.'
  fi
  echo "  ]"

  echo "}"
else
  # Text output
  echo "$SEPARATOR_LIGHT"
  echo "Issues Built/Fixed by $AUTHOR_CLAUDE"
  echo "$SEPARATOR_LIGHT"
  echo ""

  echo "$SEPARATOR_HEAVY"
  echo "Auto-Fix Issues (created by GitHub Actions, labeled '$LABEL_AUTO_FIX')"
  echo "$SEPARATOR_HEAVY"
  echo ""

  if [[ "$STATE" == "all" ]]; then
    issues=$(gh issue list --repo "$REPO" --state all --label "$LABEL_AUTO_FIX" --json number,title,state,labels,url --jq '.[] | "  #\(.number) [\(.state | ascii_upcase)] \(.title)\n         Labels: \(.labels | map(.name) | join(", "))\n         URL: \(.url)\n"')
  else
    issues=$(gh issue list --repo "$REPO" --state "$STATE" --label "$LABEL_AUTO_FIX" --json number,title,state,labels,url --jq '.[] | "  #\(.number) [\(.state | ascii_upcase)] \(.title)\n         Labels: \(.labels | map(.name) | join(", "))\n         URL: \(.url)\n"')
  fi

  if [[ -z "$issues" ]]; then
    echo "  No $LABEL_AUTO_FIX issues found."
  else
    echo "$issues"
  fi

  echo ""
  echo "$SEPARATOR_HEAVY"
  echo "Pull Requests by $AUTHOR_CLAUDE"
  echo "$SEPARATOR_HEAVY"
  echo ""

  if [[ "$STATE" == "all" ]]; then
    prs=$(gh pr list --repo "$REPO" --state all --author "$AUTHOR_CLAUDE" --json number,title,state,url,body)
  else
    prs=$(gh pr list --repo "$REPO" --state "$STATE" --author "$AUTHOR_CLAUDE" --json number,title,state,url,body)
  fi

  if [[ $(echo "$prs" | jq "$JQ_LENGTH") -eq 0 ]]; then
    echo "  No PRs by $AUTHOR_CLAUDE found."
  else
    echo "$prs" | jq -r '.[] | "  #\(.number) [\(.state | ascii_upcase)] \(.title)\n         URL: \(.url)\n" + (if (.body | test("(?:Closes?|Fixes?|Resolves?) #\\d+")) then "         Fixes: " + ([.body | scan("(?:Closes?|Fixes?|Resolves?) #(\\d+)") | "#\(.[0])"]) | join(", ") + "\n" else "" end)'
  fi

  echo ""
  echo "$SEPARATOR_LIGHT"
  echo "Summary"
  echo "$SEPARATOR_LIGHT"

  if [[ "$STATE" == "all" ]]; then
    autofix_count=$(gh issue list --repo "$REPO" --state all --label "$LABEL_AUTO_FIX" --json number --jq "$JQ_LENGTH")
    claude_pr_count=$(gh pr list --repo "$REPO" --state all --author "$AUTHOR_CLAUDE" --json number --jq "$JQ_LENGTH")
  else
    autofix_count=$(gh issue list --repo "$REPO" --state "$STATE" --label "$LABEL_AUTO_FIX" --json number --jq "$JQ_LENGTH")
    claude_pr_count=$(gh pr list --repo "$REPO" --state "$STATE" --author "$AUTHOR_CLAUDE" --json number --jq "$JQ_LENGTH")
  fi

  echo "  Auto-fix issues: $autofix_count"
  echo "  Claude PRs: $claude_pr_count"
  echo ""
fi
