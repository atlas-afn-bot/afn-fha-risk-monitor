# fha-snapshot-builder — container image

Python + FastAPI service that runs the FHA snapshot pipeline. Deployed as a
Container App by the Bicep in `../`.

## What it does

1. Receives an HTTP POST at `/trigger` with an Event Grid payload (or a manual
   payload for backfill / force-rebuild).
2. Extracts `{month}` from the blob path (`uploads/{YYYY-MM}/enc-data/...`).
3. Checks the idempotency marker (`uploads/{month}/.snapshot-built`) unless
   the request has `?force=1`.
4. Verifies all 6 source-file slots have blobs.
5. Downloads them into `/tmp/data/source/{month}/`.
6. Runs `scripts/build-snapshot.py {month}` (bundled from the repo at image
   build time).
7. Runs the anomaly gate (80% MoM loans / 30pp CR / ±1 offices).
8. Writes:
    - `snapshots/{month}.json` (overwrite current)
    - `snapshots/index.json` (updated with the new entry)
    - `snapshots/history/{month}/{ISO}.json` (immutable audit copy)
    - `snapshots/manifest.json` (append audit entry)
    - `uploads/{month}/.snapshot-built` (idempotency marker)
9. Returns a JSON summary. Non-zero exit / 500 on any hard failure.

## Auth

- **To Azure storage:** system-assigned managed identity on the Container App;
  role assignments configured by `../modules/role-assignments.bicep`. Uses
  `DefaultAzureCredential` from the SDK.
- **To the trigger endpoint itself:** requires header
  `X-Trigger-Secret: <value>` matching `$TRIGGER_SHARED_SECRET`.
  Missing or mismatched → 401.

## Endpoints

- `GET /healthz` — liveness check, returns `{ ok: true, ts, version }`.
- `POST /trigger` — pipeline entrypoint. Accepts:
  - **Event Grid schema** — normal production path
  - **Manual schema** `{ "month": "YYYY-MM", "force"?: bool }` — used for
    backfill and force-rebuild. Same auth requirements.

## Local dev

```bash
cd container
pip install -r requirements.txt
uvicorn app:app --reload --port 8080
# In another shell:
curl -H "X-Trigger-Secret: local-dev" \
     -H "Content-Type: application/json" \
     -d '{"month":"2026-06","force":true}' \
     http://localhost:8080/trigger
```

Requires `az login` in the shell first (so `DefaultAzureCredential` picks up
the CLI creds) OR export a storage connection string via
`AZURE_STORAGE_CONNECTION_STRING` (dev-only escape hatch — not used in prod).

## Build + push

```bash
ACR=crafnfhasnapshotpipeline
TAG=v0.1.0
az acr login -n $ACR
docker build -t $ACR.azurecr.io/snapshot-builder:$TAG .
docker push $ACR.azurecr.io/snapshot-builder:$TAG

# Redeploy the Container App with the new image:
az deployment group create \
  --subscription sub-afn-corp-prod-app-01 \
  --resource-group rg-afn-fha-monitor \
  --template-file ../main.bicep \
  --parameters @../params.prod.json \
               image=$ACR.azurecr.io/snapshot-builder:$TAG \
               triggerSharedSecret=$(cat ~/.secrets/fha-trigger-secret)
```
