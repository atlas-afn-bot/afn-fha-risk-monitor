<!--
  Feature PR template.
  Feature PRs target `dev`. The `dev → main` promotion PR is a separate,
  standing PR maintained automatically by the promotion-pr workflow.
-->

## Summary

<!-- What changed and why. Link the Jira/issue when applicable. -->

## Promotion checklist

- [ ] Reviewed with Michael
- [ ] Regression check: baseline dashboard matches current prod screenshot
- [ ] No new snapshot data (or new snapshot is committee-approved)
- [ ] Session-tested on Chrome + Edge
- [ ] Rollback plan documented below

## Rollback plan

<!--
  How do we undo this if it breaks prod? Usually:
  1. Revert the promotion commit on `main` (creates a revert PR).
  2. Merge the revert; production environment approval fires as normal.
  3. Optionally cherry-pick a hotfix onto `dev` afterward.
-->

## Verification

- [ ] Preview URL loads: <!-- paste dev-SWA preview URL -->
- [ ] Auth still works (Entra AAD, dev tenant)
- [ ] Existing snapshots still render (spot-check 2-3)

---

_Assistant note (ATLAS/PROMETHEUS)_: If you are opening this PR on behalf of Julian
Domingo, add `Co-authored-by: Julian Domingo <juliandomingo@afncorp.com>` at the
end of the description or in the commit message so audit trails resolve correctly.
