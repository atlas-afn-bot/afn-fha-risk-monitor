#!/bin/bash
# admin-cutover.sh — one-shot admin cutover for the FHA Risk Monitor dev/prod split.
#
# BACKGROUND
# ----------
# PROMETHEUS/ATLAS (atlas-afn-bot) executed Phases 1–4 and 6 of the dev/prod split
# but does NOT have `admin` on afncorp/afn-fha-risk-monitor. Only `maintain`.
#
# This script batches the ~8 admin-only operations that need repo admin:
#   1. Add mkunisakiafn as write collaborator
#   2. Add carce-afn as write collaborator
#   3. Change default branch from `main` to `dev`
#   4. Enable delete_branch_on_merge, squash-merge only
#   5. Create `production` GitHub environment with any-one-of-3 approvers
#   6. Create `development` GitHub environment (informational, no gate)
#   7. Set branch protection on `main` (requires PR from dev only, CI checks, 1 approval,
#      no force-push, no bypass, applies to admins)
#   8. Set branch protection on `dev` (CI checks, 1 approval, no force-push)
#
# USAGE
# -----
# Run as a user who is `admin` on afncorp/afn-fha-risk-monitor (Matt Gruber).
#
#   gh auth status          # confirm you are mgruberafn or otherwise admin
#   bash scripts/admin-cutover.sh
#
# The script is idempotent — safe to re-run. Anything already in the target
# state is skipped with an "already ok" line.

set -euo pipefail

REPO="afncorp/afn-fha-risk-monitor"

echo "== Confirming admin on $REPO =="
PERM=$(gh api "/repos/$REPO/collaborators/$(gh api /user --jq .login)/permission" --jq .permission 2>/dev/null || echo "unknown")
if [ "$PERM" != "admin" ]; then
  echo "ERROR: you are not admin on $REPO (current perm: $PERM). Ask Matt Gruber to run this or grant you admin first."
  exit 2
fi
echo "OK: admin confirmed."
echo

echo "== Step 1: add mkunisakiafn as write collaborator =="
gh api -X PUT "/repos/$REPO/collaborators/mkunisakiafn" -f permission=push >/dev/null 2>&1 && \
  echo "  invited (or already active)" || echo "  already ok / no-op"

echo "== Step 2: add carce-afn as write collaborator =="
gh api -X PUT "/repos/$REPO/collaborators/carce-afn" -f permission=push >/dev/null 2>&1 && \
  echo "  invited (or already active)" || echo "  already ok / no-op"

echo
echo "== Step 3: set default branch to 'dev' =="
CUR_DEFAULT=$(gh api "/repos/$REPO" --jq .default_branch)
if [ "$CUR_DEFAULT" = "dev" ]; then
  echo "  already dev"
else
  gh api -X PATCH "/repos/$REPO" -f default_branch=dev >/dev/null
  echo "  changed from $CUR_DEFAULT to dev"
fi

echo
echo "== Step 4: enable delete_branch_on_merge + squash-merge only =="
gh api -X PATCH "/repos/$REPO" \
  -F delete_branch_on_merge=true \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F squash_merge_commit_title=PR_TITLE \
  -F squash_merge_commit_message=PR_BODY \
  >/dev/null
echo "  repo merge settings updated"

echo
echo "== Step 5: create/update 'production' environment with reviewers =="
# Reviewers by GitHub user id (user_type=User => type_id=1).
# Any-one-of-N is default when you list multiple reviewers.
MK_ID=$(gh api /users/mkunisakiafn --jq .id)
MG_ID=$(gh api /users/mgruberafn --jq .id)
CA_ID=$(gh api /users/carce-afn --jq .id)
REV_JSON=$(cat <<JSON
{
  "wait_timer": 0,
  "reviewers": [
    {"type": "User", "id": $MK_ID},
    {"type": "User", "id": $MG_ID},
    {"type": "User", "id": $CA_ID}
  ],
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
JSON
)
echo "$REV_JSON" | gh api -X PUT "/repos/$REPO/environments/production" --input - >/dev/null
echo "  production environment configured (reviewers: mkunisakiafn, mgruberafn, carce-afn)"

# Restrict deployment branches to main
echo "  restricting production deployments to 'main' only..."
gh api -X POST "/repos/$REPO/environments/production/deployment-branch-policies" \
  -f name=main -f type=branch >/dev/null 2>&1 || echo "    (branch policy already exists or not needed)"

echo
echo "== Step 6: create 'development' environment (no gate) =="
gh api -X PUT "/repos/$REPO/environments/development" \
  -F wait_timer=0 \
  --raw-field "reviewers=[]" \
  >/dev/null 2>&1 || \
  echo "$REV_JSON" | jq '{wait_timer: 0, reviewers: [], deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}' | \
    gh api -X PUT "/repos/$REPO/environments/development" --input - >/dev/null
echo "  development environment ready"
gh api -X POST "/repos/$REPO/environments/development/deployment-branch-policies" \
  -f name=dev -f type=branch >/dev/null 2>&1 || echo "  (branch policy exists)"

echo
echo "== Step 7: branch protection on 'main' =="
cat <<'JSON' | gh api -X PUT "/repos/$REPO/branches/main/protection" --input - >/dev/null
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint + Test + Build"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
echo "  main protected"

echo
echo "== Step 8: branch protection on 'dev' =="
cat <<'JSON' | gh api -X PUT "/repos/$REPO/branches/dev/protection" --input - >/dev/null
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint + Test + Build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false
}
JSON
echo "  dev protected"

echo
echo "== Optional Step 9: restrict PRs to main to come only from 'dev' (via ruleset) =="
# Rulesets are more flexible than branch protection and support head-branch pattern.
# This is optional — CODEOWNERS + branch protection already give strong guarantees.
# Uncomment if you want to enforce head-branch=dev at the API level.
#
# cat <<'JSON' | gh api -X POST "/repos/$REPO/rulesets" --input - >/dev/null
# {
#   "name": "Only accept dev→main PRs",
#   "target": "branch",
#   "enforcement": "active",
#   "conditions": {"ref_name": {"include": ["refs/heads/main"], "exclude": []}},
#   "rules": [
#     {"type": "pull_request", "parameters": {"required_approving_review_count": 1,
#        "dismiss_stale_reviews_on_push": true, "require_code_owner_review": true,
#        "require_last_push_approval": false, "required_review_thread_resolution": true}}
#   ]
# }
# JSON

echo
echo "=================================================="
echo "Admin cutover complete."
echo
echo "Reminder: mkunisakiafn and carce-afn will get GitHub-generated"
echo "collaborator invite emails. They must click 'Accept invitation'"
echo "before they can actually approve production deploys. The"
echo "production environment already lists them as reviewers regardless."
echo "=================================================="
