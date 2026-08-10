# admin-cutover-reference.sh

**Historical reference only. Do not re-run.**

Executed on 2026-08-05 during the dev/prod split migration to apply repo-admin
operations that `atlas-afn-bot` (with default `maintain` on `afn-fha-risk-monitor`)
could not perform. On that day the bot was temporarily granted `admin` on the
repo so the script could:

- Add `mkunisakiafn` and `carce-afn` as write collaborators
- Change default branch to `dev`
- Enable `delete_branch_on_merge` + squash-merge only
- Create the `production` and `development` GitHub environments  ⚠️ **Environment reviewers turned out to be blocked on this repo — GitHub Team plan doesn't support required-reviewers on environments for private repos. See §Dev/Prod Split in `memory/afn-fha-risk-monitor.md` and the RCA at `memory/2026-08-06-fha-risk-monitor-aadsts50196-rca.md` for the alternate approach (approval-at-merge via branch protection).**
- Set branch protection on `main` and `dev`

After the cutover completed, the bot was reverted to `maintain`.

Kept here for auditability. If the org later upgrades to GitHub Enterprise Cloud
and we re-enable the environment-reviewer flow, the `production` environment
block in `scripts/` steps 5–6 is a good starting point.
