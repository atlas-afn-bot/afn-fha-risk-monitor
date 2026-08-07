# Snapshot Pipeline — Infrastructure

Bicep modules that provision the automated snapshot pipeline described in
`docs/snapshot-pipeline-design.md`.

## What lives here

| File | What it does |
|---|---|
| `main.bicep` | Orchestrator — deploys everything into the target resource group. Parameterized so the same file works for prod and (later) any dev fixture. |
| `modules/storage-container.bicep` | Creates the private `snapshots` blob container on `stafnfhauploads` and enables soft-delete on the storage account (belt-and-suspenders for the pipeline dev period). |
| `modules/log-analytics.bicep` | Log Analytics workspace for the Container Apps managed environment + Application Insights. |
| `modules/container-registry.bicep` | ACR (Basic tier) to hold the pipeline container image. |
| `modules/container-app.bicep` | Container Apps managed environment + the `fha-snapshot-builder` app itself (min 0, max 1 replica, system-assigned identity). |
| `modules/role-assignments.bicep` | RBAC — grants the Container App's identity the `Storage Blob Data Reader` role on the `uploads` container and `Storage Blob Data Contributor` on the `snapshots` container. Also grants `AcrPull` on the ACR. |

## Deploy

Prod (real target):

```bash
az deployment group create \
  --subscription sub-afn-corp-prod-app-01 \
  --resource-group rg-afn-fha-monitor \
  --template-file main.bicep \
  --parameters @params.prod.json
```

`params.prod.json` lives in this directory. It sets the storage account name,
ACR name, and Container App name so main.bicep stays clean.

## Ordering

Bicep resolves dependencies automatically, but conceptually:

1. Log Analytics workspace
2. ACR
3. Storage container (`snapshots`) + soft-delete on the storage account
4. Container Apps managed environment (needs Log Analytics)
5. Container App (needs env + ACR + a Docker image already pushed)
6. Role assignments (needs the Container App's identity to exist)

You cannot deploy step 5 until an image is in ACR. First-time bring-up:

1. Deploy steps 1–4 (Container App will be created but reference a
   placeholder image `mcr.microsoft.com/azuredocs/containerapps-helloworld:latest`)
2. Build + push the real image (see `../container/README.md`)
3. Re-run the deployment with the real image tag
4. Verify the app boots and the identity has correct role assignments

## What is NOT here (yet)

- **Event Grid subscription.** Not wired tonight — Phase 1 is "manually
  triggerable pipeline." Event Grid is a follow-up session once we've watched
  the container run reliably against real data.
- **SWA endpoint changes.** Frontend + `/api/snapshot/*` endpoints are
  Phase 2 — separate PR.
- **Alert-email routing** for anomaly-gate failures. Currently the container
  just exits non-zero and logs to App Insights. Wiring `rpa-failure-email.js`
  in as an alert action is a Phase 1c follow-up.
