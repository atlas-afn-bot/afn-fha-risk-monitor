# Read-only Files API (`/api/files`)

Programmatic read access to the FHA Risk Monitor's uploaded files in blob
storage. Built for Michael Kunisaki's RPA team — pull HUD / NW Data inputs
from the same blob store the uploader writes to, without sharing a storage
account key.

- **Base URL (prod):** `https://fha-monitor.afnai.com`
- **Local (`swa start`):** `http://localhost:4280`
- **Auth:** API-key header (`X-API-Key`). Internal-only; no public CORS.

## Why this exists

The `/uploads` page shows **5 tiles** (HUD Branches, HOC Compare Ratios,
NW Data, HUD Total Compare Ratios, HUD Field Office). The 6th backend slot
— `hud-national-totals` — is hidden from the UI as of 2026-06-22 because
RPA writes that one directly. This API is how RPA pulls **all six** slots
back out, National Totals included.

Anything that writes to `/uploads/{YYYY-MM}/{slot-slug}/...` in the
`uploads` container shows up here automatically.

## Auth

Every request must include the header:

```
X-API-Key: <FHA_FILES_API_KEY>
```

The key is stored as a Static Web App application setting named
`FHA_FILES_API_KEY`. To rotate, set a new value in the SWA Configuration
blade and redeploy (no code changes needed). To get the current value, ask
ATLAS — it's distributed out-of-band, not committed to the repo.

Responses:

| Header                | Function                     | Behavior                                |
|-----------------------|------------------------------|-----------------------------------------|
| missing               | any                          | `401 { "error": "unauthenticated" }`    |
| wrong                 | any                          | `401 { "error": "unauthenticated" }`    |
| correct               | any                          | proceed                                 |

No 403 path — RPA either has the key or doesn't; "authenticated but
unauthorized" isn't a meaningful state for this consumer.

## Endpoints

### `GET /api/files`

Lists every file in the uploads container, sorted newest first.

**Query params (all optional):**

| Param   | Format     | Example          |
|---------|------------|------------------|
| `month` | `YYYY-MM`  | `2026-05`        |
| `slot`  | slug below | `hud-branches`   |

Valid `slot` values (the backend's `CATEGORY_SLUGS`):

- `hud-branches`
- `hoc-compare-ratios`
- `nw-data`
- `hud-total-compare-ratios`
- `hud-national-totals` &nbsp;← API-only (hidden from `/uploads` UI)
- `hud-field-office`

**Example:**

```bash
curl -s \
  -H "X-API-Key: $FHA_FILES_API_KEY" \
  "https://fha-monitor.afnai.com/api/files?month=2026-05" | jq
```

**Response:**

```json
{
  "container": "uploads",
  "count": 4,
  "files": [
    {
      "month": "2026-05",
      "slot": "hud-branches",
      "filename": "HUD_Branches_5.31.26.xlsx",
      "size": 124567,
      "uploadedAt": "2026-06-17T19:23:11.000Z",
      "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "downloadUrl": "/api/files/2026-05/hud-branches/HUD_Branches_5.31.26.xlsx"
    },
    ...
  ]
}
```

Blobs whose path doesn't match `{YYYY-MM}/{slot-slug}/{filename}` are
silently skipped — only well-formed entries appear in `files`.

### `GET /api/files/{month}/{slot}/{filename}`

Returns a **302 redirect** to a short-lived (5 minute) read-only SAS URL
for the requested blob. Follow the redirect to download the bytes from
blob storage directly.

**Example (curl, follow redirects):**

```bash
curl -sL \
  -H "X-API-Key: $FHA_FILES_API_KEY" \
  -o /tmp/HUD_Branches_5.31.26.xlsx \
  "https://fha-monitor.afnai.com/api/files/2026-05/hud-branches/HUD_Branches_5.31.26.xlsx"
```

**Response headers (on the 302):**

| Header                 | Meaning                                          |
|------------------------|--------------------------------------------------|
| `Location`             | Single-blob, read-only SAS URL (5-min window)    |
| `X-Resolved-Filename`  | Actual filename written to disk (useful for `latest`) |
| `X-Expires-At`         | ISO timestamp when the SAS expires               |
| `Cache-Control`        | `no-store`                                       |

**Errors:**

| Status | When                                                |
|--------|-----------------------------------------------------|
| `401`  | Missing/invalid `X-API-Key`                         |
| `400`  | Invalid `month`, `slot`, or `filename`              |
| `404`  | Blob does not exist in `{month}/{slot}/`            |

### `GET /api/files/{month}/{slot}/latest`

Same as the specific-filename endpoint, but resolves to the blob in
`{month}/{slot}/` with the most recent `lastModified` timestamp. Useful
when RPA doesn't track filenames itself.

**Example:**

```bash
curl -sIL \
  -H "X-API-Key: $FHA_FILES_API_KEY" \
  "https://fha-monitor.afnai.com/api/files/2026-05/hud-branches/latest"
# → 302 Location: https://<storage>.blob.core.windows.net/uploads/2026-05/hud-branches/HUD_Branches_5.31.26_v2.xlsx?<SAS>
```

If the folder is empty, returns `404 { "error": "not_found" }`.

## RPA recipe (Python)

```python
import os, requests

API = "https://fha-monitor.afnai.com"
KEY = os.environ["FHA_FILES_API_KEY"]
H = {"X-API-Key": KEY}

# 1) List May 2026 files
r = requests.get(f"{API}/api/files", params={"month": "2026-05"}, headers=H, timeout=30)
r.raise_for_status()
for f in r.json()["files"]:
    print(f["slot"], f["filename"], f["size"])

# 2) Download the latest National Totals (API-only slot)
r = requests.get(
    f"{API}/api/files/2026-05/hud-national-totals/latest",
    headers=H,
    allow_redirects=True,
    timeout=60,
)
r.raise_for_status()
with open("national-totals.xlsx", "wb") as fh:
    fh.write(r.content)
```

`requests` follows the 302 to blob storage transparently — no separate
SAS handling on the RPA side.

## Notes & gotchas

- **`hud-national-totals` is API-only.** It does not appear on the
  `/uploads` page. RPA writes to it, RPA reads from it. To re-expose it
  in the UI, drop the entry from `HIDDEN_SLOT_SLUGS` in
  `src/components/tabs/FileUploads.tsx`.
- **Storage account key is never exposed.** The function holds it
  server-side (via `UPLOADS_STORAGE_CONNECTION`) and mints per-blob,
  read-only, 5-minute SAS URLs on demand.
- **No CORS opening.** This API is intended for server-to-server
  consumption (RPA bots, schedule tasks). Browser callers from non-SWA
  origins will be blocked by the browser, not the function.
- **Filename rules.** The uploader sanitizes filenames to
  `[A-Za-z0-9._-]+` (max 200 chars) — same regex enforced here. If a
  legacy blob has spaces or other characters, the API will refuse to
  resolve it by name; use `latest` instead, or rename the blob.
- **No write endpoints here.** Uploads still go through `/api/upload-sas`,
  which is SWA-SSO-gated and allowlist-checked. This API is read-only by
  design.
