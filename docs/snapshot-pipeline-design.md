# Snapshot Pipeline Design — Automated Monthly Data Ingest

**Status:** Design proposal (not yet built)
**Driver:** Michael Kunisaki (`mkunisaki@afncorp.com`)
**Long-term owner:** Julian Domingo (`juliandomingo@afncorp.com`) — per `memory/project-stakeholders.md`
**Author:** ATLAS, 2026-08-06 (via Michael's in-chat design session)
**Related design docs:** `REVISED-RATIOS-METHODOLOGY.md`

---

## Problem

Today, adding a new month of FHA data to the site requires:

1. Committee + RPA bot upload the 6 source files into `stafnfhauploads/uploads/{month}/…`
2. A human (Michael, Julian, or ATLAS) runs `python3 scripts/build-snapshot.py {month}` locally
3. Commits `public/data/snapshots/{month}.json` + updated `index.json` into git
4. PRs → merges to `dev`, waits for `Deploy — Dev`
5. Promotes `dev → main`, waits for `Deploy — Prod`
6. Site absorbs the new month

This has three problems:

- **Monthly manual toil** — a person has to be available, remember the sequence, and babysit two deploys
- **Data changes look like code releases** — every snapshot adds a git commit, a GitHub release, deploy notifications, changelog noise. Data updates should not rate a release
- **Repo bloat** — each snapshot is ~1.5–2 MB, checked into git history forever

## Goal

**Ingest monthly data automatically. Serve it to the site without touching the repo.** Code and data have different lifecycles and should ship independently.

## Design

Separate the data from the code. Snapshots live in Azure Blob storage, gated behind SWA-authenticated Function endpoints. The build pipeline runs in Azure (not GitHub Actions), triggered by Event Grid when the RPA bot's `enc-data` file lands.

### Target flow

```
┌──────────────────────────────────────────────────────────────────┐
│ prod storage: stafnfhauploads                                     │
│                                                                   │
│  uploads/{month}/                                                 │
│    ├── hud-branches/…                    ← committee upload      │
│    ├── hoc-compare-ratios/…              ← committee upload      │
│    ├── nw-data/…                         ← committee upload      │
│    ├── hud-total-compare-ratios/…        ← committee upload      │
│    ├── hud-field-office/…                ← committee upload      │
│    └── enc-data/…                        ← RPA bot writes here   │
│                    │                                              │
│                    ▼                                              │
│         Event Grid subscription                                   │
│         (blob-created, prefix uploads/*/enc-data/*.xlsx)          │
│                    │                                              │
│                    ▼                                              │
│         POST to Container App webhook                             │
└────────────────────┼──────────────────────────────────────────────┘
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│ Container App: fha-snapshot-builder                               │
│                                                                   │
│  1. Authenticate to storage via managed identity                  │
│  2. Download 6 source files from uploads/{month}/                 │
│  3. Run scripts/build-snapshot.py {month}                         │
│  4. Anomaly gate (see below) — if any check fails, alert + halt   │
│  5. Write snapshots/{month}.json + snapshots/index.json (current) │
│  6. Write snapshots/history/{month}/{ISO-timestamp}.json (audit)  │
│  7. Append snapshots/manifest.json entry                          │
│  8. Write uploads/{month}/.snapshot-built marker                  │
└────────────────────┬──────────────────────────────────────────────┘
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│ prod storage: stafnfhauploads/snapshots (private, no anon access) │
└────────────────────┬──────────────────────────────────────────────┘
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│ SWA prod (fha-monitor.afnai.com)                                  │
│                                                                   │
│  GET /api/snapshot-index    ← authenticated (Entra SSO)           │
│  GET /api/snapshot/{period} ← authenticated (Entra SSO)           │
│                                                                   │
│  Function reads blob via managed identity; returns JSON body.     │
│  Same-origin fetch. No SAS tokens in browser. No public URLs.     │
└──────────────────────────────────────────────────────────────────┘
```

No git commits per month. No PR to review. No deploy to trigger. Committee refreshes the site → site fetches → new month appears.

### Components

#### 1. New blob container: `snapshots` on `stafnfhauploads`

- **Access:** Private. No anonymous read. No public URL.
- **Layout:**
  - `snapshots/index.json` — canonical index (`{ periods: [{period, label, generated_at, file}, …] }`)
  - `snapshots/{YYYY-MM}.json` — current snapshot per month
  - `snapshots/history/{YYYY-MM}/{ISO-timestamp}.json` — every version ever built, immutable, kept forever
  - `snapshots/manifest.json` — audit log: `{ month, generated_at, source_file_md5s, build_script_sha, output_md5, event_grid_id }[]`
- **Soft-delete:** 14-day retention on the container (Azure default) — belt-and-suspenders for accidental overwrites during pipeline dev.
- **Symmetry:** dev also has a `snapshots` container on `stafnfhauploadsdev`, but the pipeline never writes to it. Dev is populated on-demand via `az storage blob copy` from prod when Michael or Julian need real data for testing.

#### 2. Container App: `fha-snapshot-builder`

- **Runtime:** Python 3.11 container with pandas + openpyxl + azure-storage-blob installed
- **Image:** built from a new Dockerfile in `infra/snapshot-pipeline/` in this repo; pushed to Azure Container Registry (`crafnfha` or reuse an existing ACR)
- **Trigger:** HTTP webhook (POST) called by Event Grid
- **Scale:** min 0, max 1 replica. Consumption-plan pricing. Idle 99.9% of the time.
- **Managed identity:** system-assigned. Role assignments:
  - `Storage Blob Data Reader` on `stafnfhauploads/uploads/` — read source files
  - `Storage Blob Data Contributor` on `stafnfhauploads/snapshots/` — write snapshot + history + manifest
- **Behavior:**
  1. Receives Event Grid payload, extracts `{month}` from the blob path (`uploads/2026-07/enc-data/...`)
  2. Checks for the idempotency marker (`uploads/{month}/.snapshot-built`) — if present and not overridden, exits silently (same pattern as `.nw-triggered`)
  3. Verifies all 6 source slots have blobs (defense in depth — Event Grid should only fire when enc-data lands, but if RPA is misconfigured we don't want a half-built snapshot)
  4. Downloads the 6 source files to `/tmp/data/source/{month}/`
  5. Checks out the repo at the pinned build-script commit (or bakes `scripts/build-snapshot.py` into the container image)
  6. Runs `python3 scripts/build-snapshot.py {month}` → produces `public/data/snapshots/{month}.json` in the temp dir
  7. **Runs the anomaly gate** — see below
  8. If the gate passes: writes `snapshots/{month}.json` (overwrite), updates `snapshots/index.json`, writes `snapshots/history/{month}/{ISO}.json`, appends `snapshots/manifest.json`, writes the marker
  9. If the gate fails: does NOT write anything; sends alert email via `rpa-failure-email.js` path
- **Cost:** ~$5–15/mo depending on how often it runs (should be ~12 times/year)

#### 3. Anomaly gate

Runs after `build-snapshot.py` produces the new JSON but before it writes anywhere. Compares the new month to the most recent prior snapshot in `index.json`.

Launch thresholds (loose — will tighten after we've seen real variance):

| Check | Trigger | Rationale |
|---|---|---|
| Loan count MoM change > **80%** | `\|new − prior\| / prior > 0.80` | Wide enough to allow a genuine boom in volume. Catches obvious corruption (empty file, wrong month uploaded, single-slot file mistake). |
| Portfolio total CR shifts > **30 percentage points** | `\|new_CR − prior_CR\| > 30` | FHA compare ratios move by a few points per month in normal ops. 30pp is 3–5× normal variance — catches "someone uploaded the wrong file" without blocking real-but-noisy months. |
| Office count differs by > **1** | `\|new_offices − prior_offices\| > 1` | Snapshots normally have 77–92 offices; ±1 monthly variance is normal. Anything larger implies a truncated `hud-field-office` file. |

If **any** check trips: the pipeline halts, no snapshot is written, an alert email fires to Michael (and Julian) via the existing `rpa-failure-email.js` path with a message like:

> **FHA snapshot build failed for 2026-07 — anomaly gate.**
> Loan count MoM: 9,560 → 4,213 (−55.9%, threshold 80%)
> Portfolio CR shift: 145 → 152 (+7 pts, threshold 30pp) — OK
> Office count: 79 → 20 (−59, threshold ±1)
>
> Please review source files in `uploads/2026-07/` and re-run the pipeline manually (POST to `<container-app-url>/rebuild?month=2026-07`).

Nothing hits the site until a human confirms the data is real.

#### 4. New SWA Function endpoints

Add two new endpoints under `api/`:

**`GET /api/snapshot-index`**
- Auth: `authenticated` role (SWA Entra SSO)
- Reads `stafnfhauploads/snapshots/index.json` via managed identity
- Returns the JSON body
- Cache-Control: `private, max-age=300`

**`GET /api/snapshot/{period}`**
- Auth: `authenticated` role (SWA Entra SSO)
- Path param `{period}` = `YYYY-MM`; validated against `MONTH_RE`
- Reads `stafnfhauploads/snapshots/{period}.json` via managed identity
- Returns the JSON body (or 404 if not found)
- Cache-Control: `private, max-age=300`

Both endpoints follow the same pattern as `list-recent-uploads` — SWA principal check via `x-ms-client-principal` header, then a server-side blob read.

**Managed identity setup:** grant the prod SWA's Function app a system-assigned identity with `Storage Blob Data Reader` on `stafnfhauploads/snapshots/`. Never touches the blob keys directly.

#### 5. Frontend change

`src/lib/snapshotLoader.ts`, one-line base URL change:

```diff
- const idx = await fetchJson<SnapshotIndex>('data/snapshots/index.json');
+ const idx = await fetchJson<SnapshotIndex>('api/snapshot-index');
```

```diff
- const snap = await fetchJson<Snapshot>(`data/snapshots/${period}.json`);
+ const snap = await fetchJson<Snapshot>(`api/snapshot/${period}`);
```

Same-origin fetch → no CORS. Auth cookie is already attached because the SWA sets it on `/.auth/*` after Entra SSO.

### Security & data classification

- FHA compare ratios + loan-level detail (FICO scores, DTI, delinquency status) = internal data, not for public consumption
- **Anonymous blob read is not acceptable** → private container
- **SAS tokens in the browser are not acceptable** → Function proxy pattern instead
- All access flows through SWA Entra SSO → same auth surface as the site itself
- Application Insights logs every fetch → audit trail: "who fetched what, when"
- Managed identity, not connection strings → no secrets to rotate or leak

### Rollout plan

Phased. Each phase is independent and reversible.

**Phase 1 — Infra (no site impact)**
- Provision the new `snapshots` container on `stafnfhauploads` via Bicep
- Provision the Container App, ACR, and Event Grid subscription
- Backfill the existing 5 snapshots (`2026-02.json` through `2026-06.json`) from git into the blob container manually via `az storage blob copy`
- Verify the pipeline end-to-end by manually POST-ing to the Container App webhook with a hand-crafted Event Grid payload for `2026-06` (already-built month — should be a no-op because of the idempotency marker; then override with a `?force=1` to rebuild and compare against the current in-repo copy)

**Phase 2 — Dev cutover**
- Deploy the two new endpoints to the dev SWA
- Point dev's frontend at `/api/snapshot-index` and `/api/snapshot/{period}` (still reading from prod's `snapshots` container — dev has no writer)
- Verify dev site works end-to-end against blob-served data

**Phase 3 — Prod cutover**
- Promote the endpoint + frontend changes to `main`
- Delete `public/data/snapshots/*.json` from the repo (a follow-up PR after we've watched prod on blob data for at least a week)
- From this point forward: monthly refresh is automatic

**Phase 4 — Post-launch monitoring**
- Watch the anomaly gate for two months of real data. Tighten thresholds if consistent variance is much lower than 80% / 30pp / ±1.

### Rollback

- **Bad snapshot data on prod:** delete `snapshots/{month}.json` (soft-delete restores prior version within 14 days). Update `index.json` to drop the entry. Next page fetch shows the prior month.
- **Bad pipeline release:** revert the Container App image tag to the prior version. Redeploy via `az containerapp update --image <prior-tag>`.
- **Bad endpoint change on SWA:** standard git revert + `Deploy — Prod` workflow_dispatch.
- **Bad frontend change:** same — git revert + redeploy.

### What's out of scope

- **Not** a rewrite of `scripts/build-snapshot.py`. That script stays as-is.
- **Not** a change to how the RPA bot works or how AA WLM enqueues.
- **Not** a change to `/api/upload-sas`, `/api/files-*`, or `/api/nw-trigger-check`. Those are upstream and untouched.
- **Not** a public API. All endpoints are internal, SSO-gated.
- **Not** a dev-side pipeline. Pipeline runs against prod storage only. Dev site reads prod's snapshots (no automated sync — Michael manually copies to dev when needed).

### Cost estimate

| Resource | Est. monthly |
|---|---|
| Container App (consumption, ~12 runs/mo × ~90s each) | $5–10 |
| Blob storage (~2 MB × 12 months × forever, LRS hot) | negligible (< $1) |
| Event Grid subscription (~12 events/mo) | negligible |
| ACR (basic tier, one image) | $5 |
| Application Insights (existing, adds ~MB/mo) | negligible |
| **Total** | **~$10–15/mo** |

Compare to today's cost: ~1–2 hours of human time per month to run the manual pipeline. At any reasonable dollar value of human time, this pays back in the first month.

### Prerequisites (one-time)

1. **New private blob container** `snapshots` on `stafnfhauploads` — provision via Bicep
2. **Managed identity on prod SWA Function app** — system-assigned, granted `Storage Blob Data Reader` on the new container
3. **Container App + ACR + Event Grid subscription** — provisioned via Bicep in `infra/snapshot-pipeline/`
4. **Backfill script** — one-time copy of existing snapshots from repo into blob container
5. **Alert email routing** — extend `api/lib/rpa-failure-email.js` (or add a sibling) to handle pipeline-failure alerts to Michael + Julian

### Decided design questions (Michael, 2026-08-06)

- **Dev SWA data source:** Manual copy from prod to dev when needed. Not automatic. Dev's `snapshots` container is only touched on demand.
- **History retention:** Keep the `snapshots/history/…` immutable copies forever. Storage cost is negligible; no rollup policy.
- **Anomaly gate — loan count threshold:** 80% MoM change (widened from an initial 20% proposal to allow room for a genuine volume boom).
- **Anomaly gate — portfolio CR + office count:** 30 percentage points and ±1 offices, as originally proposed.
- **Container Apps vs. Functions Premium:** Container Apps. Better fit for the pandas/openpyxl workload, cheaper (~$5–15/mo vs. ~$80/mo).

### Open engineering questions (to resolve during build)

- **Container image build/push:** GitHub Actions vs. `az acr build` from local. Lean: GitHub Actions on push to `main` under `infra/snapshot-pipeline/`, following the existing SWA deploy pattern.
- **Event Grid → Container App auth:** direct anonymous webhook (with a shared-secret header) vs. Service Bus queue in between. Lean: direct webhook with shared secret in a header the Container App verifies.
- **Manifest.json write concurrency:** single-writer pipeline means we won't hit races in practice, but do we add a lease-based lock anyway for belt-and-suspenders? Lean: yes, use blob lease for the manifest write path.
- **Retry on transient failures:** Container App itself retries via Event Grid delivery attempts (default 24h, exponential backoff). Do we add app-level retries too? Lean: no, Event Grid retries are sufficient.

### Success criteria

Once shipped, one full end-to-end verification cycle:

1. Wait for July 2026 data (natural next cycle)
2. Committee + bot upload the 6 source files as usual
3. Pipeline fires within 60s of enc-data landing
4. Snapshot appears in `snapshots/2026-07.json` and `snapshots/history/2026-07/{ISO}.json`
5. `snapshots/index.json` shows `2026-07` at the top
6. `snapshots/manifest.json` has the audit entry
7. Site refresh on prod shows July in the month selector, with all the same offices/loans/ratios `build-snapshot.py` produced
8. Zero git commits, zero deploys, zero human touches

If any of those don't happen: rollback per the plan above, root-cause, retry.

---

## Snapshot field: `risk_factor_bullets` (PR A / PR B, 2026-08-11)

**Status:** PR A landed — bake at build time. PR B forthcoming — frontend consumer + on-demand regenerate write-back.
**Driver:** Michael Kunisaki
**Owner:** ATLAS + dev-architect subagent

### Motivation

The Executive Summary card renders 6 AI-generated bullets summarizing risk-factor trends (Manual UW vs Auto, LTV bands, DTI, payment shock, reserves, source of funds, layered risk indicators). Historically the frontend calls `/api/ai-analysis` (Azure OpenAI proxy → `brady-wu-ai/gpt-4-brady`) on every period load unless cached in browser `sessionStorage`. Three problems:

- **Cost** — every reviewer, every period switch, one LLM round-trip. Multiplies with committee size and audit reruns.
- **Latency** — the card blocks on a ~10–20s Azure OpenAI call after page load.
- **Cross-user duplication** — each user's `sessionStorage` cache is siloed; two reviewers looking at the same month generate the same bullets twice.

Baking the bullets into the snapshot at pipeline build time makes them a first-class artifact alongside `ai_insights`, `projections`, `underwriter_rollup`, etc.

### Schema

New optional top-level field on `snapshots/{period}.json`:

```json
"risk_factor_bullets": {
  "bullets": [
    { "text": "...", "severity": "red|yellow|green|neutral" }
  ],
  "generated_at": "<ISO-8601>",
  "generated_by": "scripts/build-snapshot.py v<version>",
  "regenerated_by": null,
  "regenerated_at": null,
  "schema_version": 1
}
```

- **`bullets`** — usually 6, but the prompt does not hard-cap; PR B's frontend must render 0–N gracefully. Each bullet is a `{text, severity}` pair. Severity maps to the existing red/yellow/green/neutral treatments the Executive Summary card already uses.
- **`generated_at` / `generated_by`** — populated by the initial bake. `generated_by` mirrors `snapshot_meta.generated_by` (same `SCRIPT_VERSION`).
- **`regenerated_at` / `regenerated_by`** — always `null` in a fresh bake. Mutated by PR B's on-demand regenerate write-back path: when a reviewer clicks "regenerate" in the Executive Summary card, the SWA API replaces `bullets` and stamps `regenerated_at = now`, `regenerated_by = Entra oid`. The initial `generated_*` fields stay intact so provenance survives regenerates.
- **`schema_version`** — `1` at launch. Bump if we ever add/remove fields.
- **Optional on `Snapshot`** — historical snapshots (Feb–May 2026, built before this feature) don't carry the field. Frontend consumers must feature-detect and fall back to the legacy on-demand fetch when absent.

### Provenance semantics

| Scenario | `generated_at` / `generated_by` | `regenerated_at` / `regenerated_by` |
|---|---|---|
| Fresh bake, never regenerated | Set by build-snapshot.py | `null` |
| Reviewer clicked "regenerate" once | Preserved (original bake) | Set by SWA API to now + reviewer's Entra `oid` |
| Reviewer regenerated multiple times | Preserved (original bake) | Overwritten each time with the latest regenerate |
| Full snapshot rebuild via pipeline | Overwritten (new bake) | Reset to `null` |

Interpretation: `generated_*` is the immutable canonical bake; `regenerated_*` is the "if I look at this today, whose version am I seeing?" audit hook.

### Shared prompt file

Both callers load the exact same system prompt from `data/prompts/risk-factor-analysis.system.md`:

1. **`scripts/build-snapshot.py :: build_risk_factor_bullets()`** — the build-time bake (PR A).
2. **`api/ai-analysis/index.js`** — the SWA proxy that lets reviewers regenerate on demand (PR B; today the prompt is a string literal in `src/lib/aiAnalysis.ts`).

Any prompt change here affects both callers. If you're tuning the prompt for one caller only, you're doing it wrong: either add a second file with a distinct name, or split the callers first. The prompt requests both `executiveSummary` and `actionItems` fields; PR A discards `actionItems` (they're unused today) but keeps them in the response schema so PR B's regenerate path can share the file byte-for-byte.

The Dockerfile bundles `data/prompts/` alongside `scripts/build-snapshot.py` so the Container App runtime has the file on disk.

### Failure semantics

`build_risk_factor_bullets` **never** raises. On any error — missing prompt file, missing `AZURE_OPENAI_*` config, LLM timeout, malformed JSON response, missing `executiveSummary` key — it logs a WARN line and returns `[]`. The snapshot build continues and writes a `risk_factor_bullets.bullets = []` shape. The frontend (PR B) treats an empty bullet list as "show the on-demand regenerate button prominently" so a bad bake still degrades gracefully.

This matches the design principle from `build_ai_insights`: the LLM is nice-to-have, not load-bearing. Pipeline reliability > AI narrative.

### Forward reference: PR B

PR B (the paired follow-up PR, not yet open) covers:

1. `src/components/ExecutiveSummary.tsx` reads `snapshot.risk_factor_bullets?.bullets` first; falls back to the legacy `/api/ai-analysis` call only when the field is absent or empty.
2. Delete the browser `sessionStorage` cache in `src/lib/aiAnalysis.ts` (baking makes it redundant).
3. `api/ai-analysis/index.js` gains a "regenerate" mode that reads `data/prompts/risk-factor-analysis.system.md`, calls Azure OpenAI, and writes back to `snapshots/{period}.json` with updated `regenerated_at` / `regenerated_by`. Uses managed identity + blob lease for the write path.
4. Frontend button on the Executive Summary card that hits the regenerate endpoint; shows a spinner while the write is in flight.

Until PR B lands, the frontend continues to work exactly as it does today — it just ignores the new field. That's why PR A is safe to merge on its own.

---

## Retired slot: `hud-national-totals` (do not re-introduce)

**Status:** Retired 2026-08-11. Do NOT add this slot back to `SLOT_ALIAS_TABLE`, `CATEGORY_SLUGS`, the `upload-sas` allowlist, or the `FileUploads.tsx` slot cards.

### Why it was retired

`hud-national-totals` was an early name for what is now `hud-total-compare-ratios`. During the 2026-05 upload cycle the RPA wrote the same source file into both prefixes (`2026-05/hud-national-totals/HUD_Total_Compare_Ratio_5.31.26.xls` and `2026-05/hud-total-compare-ratios/HUD_Total_Compare_Ratio_5.31.26.xls`, byte-identical, MD5 `NgEjvgDexNVqUam5GHCKjA==`). Starting 2026-06 the RPA writes only to `hud-total-compare-ratios/` (June's blob is literally named `HUD_National_Totals_6.30.26.xlsx` but lives inside the `hud-total-compare-ratios/` prefix — same file, correct slot).

The snapshot pipeline never referenced `hud-national-totals` (grep `scripts/build-snapshot.py` for `hud_national_totals` → zero hits). The upload UI never surfaced it either. The stale `2026-05/hud-national-totals/` prefix was blob-only lint.

### Cleanup done

- Deleted `2026-05/hud-national-totals/HUD_Total_Compare_Ratio_5.31.26.xls` (byte-identical copy preserved in `2026-05/hud-total-compare-ratios/`). Verified same MD5 before delete.
- No code change was needed; the slot was already absent from every code path.

### If you see it again

If a future upload lands in `<month>/hud-national-totals/`, the RPA regressed. Fix at the RPA side (route to `hud-total-compare-ratios/`), then delete the misplaced blob. Do not re-add the slot alias to "handle" it in code.
