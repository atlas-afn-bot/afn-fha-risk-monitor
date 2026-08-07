"""FHA snapshot pipeline container — trigger endpoint + orchestrator.

Reads the six monthly source files from `stafnfhauploads/uploads/{month}/`,
runs the bundled `build-snapshot.py` script, applies the anomaly gate, and
writes the resulting JSON + audit artifacts to `stafnfhauploads/snapshots/`.

See `README.md` in this directory for the full contract and endpoint docs.

Design invariants:
    - No storage secrets in this container. All storage access uses
      `DefaultAzureCredential` (managed identity in prod; az CLI creds locally).
    - Idempotent by default. `POST /trigger` with the same month is a no-op
      unless the caller sets `force=true`.
    - Anomaly gate is a hard stop. If it trips, nothing is written; the
      pipeline exits non-zero (500 on the HTTP response) with a structured
      diagnostic. Marker is NOT written on gate failure — a re-run stays
      necessary.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from azure.core.exceptions import ResourceNotFoundError
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContainerClient
from fastapi import FastAPI, HTTPException, Header, Request

# ─────────────────────────────────────────────────────────────────────────
# Config from environment
# ─────────────────────────────────────────────────────────────────────────
STORAGE_ACCOUNT_NAME = os.environ.get("STORAGE_ACCOUNT_NAME", "stafnfhauploads")
UPLOADS_CONTAINER = os.environ.get("UPLOADS_CONTAINER", "uploads")
SNAPSHOTS_CONTAINER = os.environ.get("SNAPSHOTS_CONTAINER", "snapshots")
TRIGGER_SHARED_SECRET = os.environ.get("TRIGGER_SHARED_SECRET", "")
APP_VERSION = os.environ.get("APP_VERSION", "0.1.0")

# Slots defined in api/upload-sas/index.js CATEGORY_SLUGS.
REQUIRED_SLOTS = (
    "hud-branches",
    "hoc-compare-ratios",
    "nw-data",
    "hud-total-compare-ratios",
    "hud-field-office",
    "enc-data",
)

MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
BLOB_MONTH_RE = re.compile(r"^uploads/(\d{4}-\d{2})/enc-data/[^/]+$")

MARKER_BLOB_NAME_SUFFIX = ".snapshot-built"

# Anomaly gate thresholds — see docs/snapshot-pipeline-design.md.
ANOMALY_LOAN_COUNT_MAX_MOM_PCT = 0.80          # 80% MoM change
ANOMALY_PORTFOLIO_CR_MAX_SHIFT = 30.0          # 30 pp
ANOMALY_OFFICE_COUNT_MAX_DELTA = 1             # ±1 offices

# Where the bundled repo lives inside the image.
REPO_ROOT = Path(os.environ.get("REPO_ROOT", "/opt/repo"))
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build-snapshot.py"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("snapshot-pipeline")


# ─────────────────────────────────────────────────────────────────────────
# Azure clients (lazy singletons)
# ─────────────────────────────────────────────────────────────────────────
_credential: Optional[DefaultAzureCredential] = None
_blob_service: Optional[BlobServiceClient] = None


def credential() -> DefaultAzureCredential:
    global _credential
    if _credential is None:
        _credential = DefaultAzureCredential()
    return _credential


def blob_service() -> BlobServiceClient:
    global _blob_service
    if _blob_service is None:
        # Escape hatch for local dev — if AZURE_STORAGE_CONNECTION_STRING is
        # set, use it. Never set in prod (Container App has no such env var).
        conn = os.environ.get("AZURE_STORAGE_CONNECTION_STRING")
        if conn:
            _blob_service = BlobServiceClient.from_connection_string(conn)
        else:
            url = f"https://{STORAGE_ACCOUNT_NAME}.blob.core.windows.net"
            _blob_service = BlobServiceClient(account_url=url, credential=credential())
    return _blob_service


def uploads_container() -> ContainerClient:
    return blob_service().get_container_client(UPLOADS_CONTAINER)


def snapshots_container() -> ContainerClient:
    return blob_service().get_container_client(SNAPSHOTS_CONTAINER)


# ─────────────────────────────────────────────────────────────────────────
# Dataclasses
# ─────────────────────────────────────────────────────────────────────────
@dataclass
class AnomalyReport:
    passed: bool
    checks: dict
    prior_period: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "passed": self.passed,
            "checks": self.checks,
            "prior_period": self.prior_period,
        }


# ─────────────────────────────────────────────────────────────────────────
# Trigger helpers
# ─────────────────────────────────────────────────────────────────────────
def parse_trigger_payload(body: Any) -> tuple[str, bool]:
    """Extract (month, force) from either an Event Grid or manual payload.

    Manual: {"month": "YYYY-MM", "force"?: bool}
    Event Grid (blob-created): [{"subject": ".../uploads/YYYY-MM/enc-data/...", ...}]

    Returns:
        (month, force)

    Raises:
        HTTPException(400) if the payload is unparseable.
    """
    if isinstance(body, list) and body:
        # Event Grid batch (real production path).
        item = body[0]
        subject = str(item.get("subject", ""))
        # Subject format: /blobServices/default/containers/uploads/blobs/YYYY-MM/enc-data/...
        m = re.search(r"containers/[^/]+/blobs/(\d{4}-\d{2})/enc-data/", subject)
        if not m:
            raise HTTPException(400, f"Cannot parse month from Event Grid subject: {subject}")
        return m.group(1), False

    if isinstance(body, dict):
        month = body.get("month")
        if not month or not MONTH_RE.match(str(month)):
            raise HTTPException(400, "Body must include 'month' as YYYY-MM.")
        force = bool(body.get("force", False))
        return str(month), force

    raise HTTPException(400, "Unrecognized trigger payload shape.")


def verify_trigger_secret(header_value: Optional[str]) -> None:
    if not TRIGGER_SHARED_SECRET:
        # Local dev with no secret configured — allow, but log loudly.
        log.warning("TRIGGER_SHARED_SECRET is empty; skipping auth check (dev only!)")
        return
    if not header_value or not hmac.compare_digest(header_value, TRIGGER_SHARED_SECRET):
        raise HTTPException(401, "Missing or invalid X-Trigger-Secret header.")


# ─────────────────────────────────────────────────────────────────────────
# Storage helpers
# ─────────────────────────────────────────────────────────────────────────
def marker_exists(month: str) -> bool:
    marker = f"{month}/{MARKER_BLOB_NAME_SUFFIX}"
    try:
        uploads_container().get_blob_client(marker).get_blob_properties()
        return True
    except ResourceNotFoundError:
        return False


def write_marker(month: str, meta: dict) -> None:
    marker = f"{month}/{MARKER_BLOB_NAME_SUFFIX}"
    body = json.dumps(meta, sort_keys=True).encode("utf-8")
    uploads_container().get_blob_client(marker).upload_blob(
        body,
        overwrite=True,
        content_type="application/json",
    )


def delete_marker(month: str) -> None:
    marker = f"{month}/{MARKER_BLOB_NAME_SUFFIX}"
    try:
        uploads_container().get_blob_client(marker).delete_blob()
    except ResourceNotFoundError:
        pass  # Not present — fine.


def verify_all_slots_present(month: str) -> list[str]:
    """Return the list of MISSING slot names. Empty list = all present."""
    missing = []
    for slot in REQUIRED_SLOTS:
        prefix = f"{month}/{slot}/"
        has_blob = False
        for _ in uploads_container().list_blobs(name_starts_with=prefix):
            has_blob = True
            break
        if not has_blob:
            missing.append(slot)
    return missing


def download_source_files(month: str, dest_dir: Path) -> dict[str, str]:
    """Download every blob under uploads/{month}/<slot>/ into dest_dir.

    Layout on disk mirrors what build-snapshot.py's `_find_source` expects:
        dest_dir/{slot}/<original-filename>

    Returns:
        dict mapping "slot/filename" -> md5 hex string
    """
    md5s: dict[str, str] = {}
    dest_dir.mkdir(parents=True, exist_ok=True)

    for slot in REQUIRED_SLOTS:
        prefix = f"{month}/{slot}/"
        slot_dir = dest_dir / slot
        slot_dir.mkdir(exist_ok=True)

        for blob in uploads_container().list_blobs(name_starts_with=prefix):
            filename = blob.name[len(prefix):]
            if not filename or filename.endswith("/"):
                continue
            target = slot_dir / filename
            target.parent.mkdir(parents=True, exist_ok=True)

            log.info("Downloading %s -> %s", blob.name, target)
            data = uploads_container().get_blob_client(blob.name).download_blob().readall()
            target.write_bytes(data)

            md5s[f"{slot}/{filename}"] = hashlib.md5(data).hexdigest()

    return md5s


# ─────────────────────────────────────────────────────────────────────────
# Snapshot execution
# ─────────────────────────────────────────────────────────────────────────
def build_script_sha() -> str:
    """MD5 of the bundled build-snapshot.py. Cheap identity for the manifest."""
    return hashlib.md5(BUILD_SCRIPT.read_bytes()).hexdigest()


def run_build_snapshot(month: str, working_dir: Path, source_dir: Path) -> Path:
    """Invoke `build-snapshot.py {month}` inside a synthetic repo tree.

    The script expects to find:
        <repo>/data/source/{month}/<slot>/<file>.xlsx
    and writes to:
        <repo>/public/data/snapshots/{month}.json

    We set up that structure under `working_dir` and shell out.

    Returns:
        Path to the produced snapshot JSON.
    """
    data_source = working_dir / "data" / "source" / month
    data_source.mkdir(parents=True, exist_ok=True)
    # Move / copy every downloaded file under the slot dirs into the expected
    # layout. build-snapshot.py globs by slot prefix, so we just mirror.
    for slot_dir in source_dir.iterdir():
        if not slot_dir.is_dir():
            continue
        for f in slot_dir.iterdir():
            if f.is_file():
                shutil.copy2(f, data_source / f.name)

    snap_out = working_dir / "public" / "data" / "snapshots" / f"{month}.json"
    snap_out.parent.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    # Point the bundled script at our working tree without having to write into
    # the image's /opt/repo layout. Requires the SNAPSHOT_SOURCE_ROOT/
    # SNAPSHOT_OUTPUT_DIR overrides added to scripts/build-snapshot.py.
    env["SNAPSHOT_SOURCE_ROOT"] = str(working_dir / "data" / "source")
    env["SNAPSHOT_OUTPUT_DIR"] = str(working_dir / "public" / "data" / "snapshots")

    log.info("Running build-snapshot.py for %s (cwd=%s)", month, working_dir)
    result = subprocess.run(
        [sys.executable, str(BUILD_SCRIPT), month],
        cwd=str(working_dir),
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    log.info("build-snapshot stdout (last 2KB):\n%s", result.stdout[-2000:])
    if result.stderr:
        log.warning("build-snapshot stderr (last 2KB):\n%s", result.stderr[-2000:])
    if result.returncode != 0:
        raise RuntimeError(
            f"build-snapshot.py exited {result.returncode}. Stderr tail: {result.stderr[-500:]}"
        )
    if not snap_out.exists():
        raise RuntimeError(
            f"build-snapshot.py claimed success but did not write {snap_out}"
        )
    return snap_out


# ─────────────────────────────────────────────────────────────────────────
# Anomaly gate
# ─────────────────────────────────────────────────────────────────────────
def load_prior_snapshot() -> tuple[Optional[str], Optional[dict]]:
    """Return (period, snapshot_json) for the most recent existing snapshot,
    or (None, None) if none exists (e.g. first-ever run)."""
    try:
        idx_blob = snapshots_container().get_blob_client("index.json")
        idx = json.loads(idx_blob.download_blob().readall())
    except ResourceNotFoundError:
        return None, None

    periods = idx.get("periods") or []
    if not periods:
        return None, None
    latest_period = periods[0]["period"]
    latest_file = periods[0].get("file", f"{latest_period}.json")
    try:
        snap_blob = snapshots_container().get_blob_client(latest_file).download_blob()
        return latest_period, json.loads(snap_blob.readall())
    except ResourceNotFoundError:
        return None, None


def _extract_summary(snap: dict) -> dict:
    """Pull the three anomaly-check inputs from a snapshot JSON."""
    loans = snap.get("loans") or []
    offices = snap.get("compare_ratios_hud_office") or []
    total = snap.get("compare_ratios_total") or {}
    portfolio_cr = total.get("compare_ratio") if isinstance(total, dict) else None
    # `compare_ratios_total` is sometimes a list with one row.
    if portfolio_cr is None and isinstance(total, list) and total:
        portfolio_cr = total[0].get("compare_ratio")
    return {
        "loan_count": len(loans),
        "office_count": len(offices),
        "portfolio_cr": portfolio_cr,
    }


def anomaly_gate(new_snap: dict, prior_period: Optional[str], prior_snap: Optional[dict]) -> AnomalyReport:
    """Compare new snapshot to the prior one. Return a report; caller decides.

    First-ever run has no prior — auto-passes.
    """
    if prior_snap is None:
        return AnomalyReport(
            passed=True,
            checks={
                "note": "no prior snapshot — gate skipped (first-ever run)",
            },
            prior_period=None,
        )

    new = _extract_summary(new_snap)
    prior = _extract_summary(prior_snap)

    checks: dict[str, Any] = {}

    # ── Loan count MoM % change ────────────────────────────────────────
    prior_loans = prior["loan_count"] or 0
    new_loans = new["loan_count"] or 0
    if prior_loans > 0:
        mom_pct = abs(new_loans - prior_loans) / prior_loans
    else:
        mom_pct = 0.0  # No prior data — inherently unbounded; do not fail.
    checks["loan_count"] = {
        "prior": prior_loans,
        "new": new_loans,
        "mom_pct": round(mom_pct, 4),
        "threshold": ANOMALY_LOAN_COUNT_MAX_MOM_PCT,
        "passed": mom_pct <= ANOMALY_LOAN_COUNT_MAX_MOM_PCT,
    }

    # ── Portfolio CR shift ─────────────────────────────────────────────
    prior_cr = prior.get("portfolio_cr")
    new_cr = new.get("portfolio_cr")
    if prior_cr is not None and new_cr is not None:
        cr_shift = abs(float(new_cr) - float(prior_cr))
        cr_passed = cr_shift <= ANOMALY_PORTFOLIO_CR_MAX_SHIFT
    else:
        cr_shift = None
        cr_passed = True  # Missing CR — do not fail on the gate.
    checks["portfolio_cr"] = {
        "prior": prior_cr,
        "new": new_cr,
        "shift_pp": cr_shift,
        "threshold_pp": ANOMALY_PORTFOLIO_CR_MAX_SHIFT,
        "passed": cr_passed,
    }

    # ── Office count delta ─────────────────────────────────────────────
    delta = abs(new["office_count"] - prior["office_count"])
    checks["office_count"] = {
        "prior": prior["office_count"],
        "new": new["office_count"],
        "delta": delta,
        "threshold": ANOMALY_OFFICE_COUNT_MAX_DELTA,
        "passed": delta <= ANOMALY_OFFICE_COUNT_MAX_DELTA,
    }

    passed = all(c["passed"] for c in checks.values())
    return AnomalyReport(passed=passed, checks=checks, prior_period=prior_period)


# ─────────────────────────────────────────────────────────────────────────
# Output writers (blob)
# ─────────────────────────────────────────────────────────────────────────
def write_snapshot_outputs(month: str, snapshot_json: bytes, event_id: Optional[str],
                            source_md5s: dict, build_sha: str) -> tuple[str, str]:
    """Write the current snapshot, immutable history copy, updated index, and
    manifest entry. Returns (history_blob_name, output_md5).
    """
    snapshots = snapshots_container()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    history_name = f"history/{month}/{now_iso}.json"

    # ── Current snapshot (overwrite) ──────────────────────────────────
    snapshots.get_blob_client(f"{month}.json").upload_blob(
        snapshot_json,
        overwrite=True,
        content_type="application/json",
    )

    # ── Immutable history copy ────────────────────────────────────────
    snapshots.get_blob_client(history_name).upload_blob(
        snapshot_json,
        overwrite=False,
        content_type="application/json",
    )

    # ── Updated index.json ────────────────────────────────────────────
    idx = {"periods": []}
    try:
        idx = json.loads(snapshots.get_blob_client("index.json").download_blob().readall())
    except ResourceNotFoundError:
        pass

    # Compute the label + performance_period from the snapshot itself.
    snap_dict = json.loads(snapshot_json)
    entry = {
        "period": month,
        "label": snap_dict.get("label") or _month_label(month),
        "performance_period": snap_dict.get("performance_period") or f"{month}-01",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "file": f"{month}.json",
    }
    periods = [p for p in idx.get("periods", []) if p.get("period") != month]
    periods.insert(0, entry)
    # Sort descending by period so first is newest.
    periods.sort(key=lambda p: p.get("period", ""), reverse=True)
    new_idx = {"periods": periods}
    snapshots.get_blob_client("index.json").upload_blob(
        json.dumps(new_idx, indent=2).encode("utf-8"),
        overwrite=True,
        content_type="application/json",
    )

    # ── Manifest append ───────────────────────────────────────────────
    manifest = {"entries": []}
    try:
        manifest = json.loads(snapshots.get_blob_client("manifest.json").download_blob().readall())
    except ResourceNotFoundError:
        pass
    output_md5 = hashlib.md5(snapshot_json).hexdigest()
    manifest.setdefault("entries", []).append({
        "month": month,
        "generated_at": entry["generated_at"],
        "history_blob": history_name,
        "output_md5": output_md5,
        "source_file_md5s": source_md5s,
        "build_script_md5": build_sha,
        "event_id": event_id,
        "app_version": APP_VERSION,
    })
    snapshots.get_blob_client("manifest.json").upload_blob(
        json.dumps(manifest, indent=2).encode("utf-8"),
        overwrite=True,
        content_type="application/json",
    )

    return history_name, output_md5


def _month_label(month: str) -> str:
    y, m = month.split("-")
    return datetime(int(y), int(m), 1).strftime("%B %Y")


# ─────────────────────────────────────────────────────────────────────────
# HTTP surface
# ─────────────────────────────────────────────────────────────────────────
app = FastAPI(title="fha-snapshot-builder", version=APP_VERSION)


@app.get("/healthz")
def healthz():
    return {
        "ok": True,
        "ts": datetime.now(timezone.utc).isoformat(),
        "version": APP_VERSION,
    }


@app.post("/trigger")
async def trigger(request: Request, x_trigger_secret: Optional[str] = Header(None)):
    verify_trigger_secret(x_trigger_secret)

    body = await request.json()
    month, forced_from_body = parse_trigger_payload(body)

    # Allow force=true also via query string (handy for curl).
    force = forced_from_body or (request.query_params.get("force", "").lower() in ("1", "true", "yes"))

    started = datetime.now(timezone.utc)
    log.info("Trigger received for %s (force=%s)", month, force)

    # Idempotency
    if not force and marker_exists(month):
        log.info("Marker exists for %s; skipping.", month)
        return {
            "month": month,
            "triggered": False,
            "reason": "marker_exists",
            "forced": False,
        }

    # Slot completeness
    missing = verify_all_slots_present(month)
    if missing:
        log.error("Slots missing for %s: %s", month, missing)
        raise HTTPException(422, detail={"month": month, "missing_slots": missing})

    # Everything ready — download, build, gate, write.
    workdir = Path(tempfile.mkdtemp(prefix=f"snap-{month}-"))
    source_dir = workdir / "downloaded"
    source_dir.mkdir()
    try:
        source_md5s = download_source_files(month, source_dir)
        snap_json_path = run_build_snapshot(month, workdir, source_dir)
        snap_bytes = snap_json_path.read_bytes()
        snap_dict = json.loads(snap_bytes)

        prior_period, prior_snap = load_prior_snapshot()
        report = anomaly_gate(snap_dict, prior_period, prior_snap)
        log.info("Anomaly gate: passed=%s prior=%s checks=%s", report.passed, report.prior_period, report.checks)
        if not report.passed:
            # Do NOT write outputs. Do NOT write the marker. Fail loudly.
            raise HTTPException(
                422,
                detail={
                    "month": month,
                    "reason": "anomaly_gate_failed",
                    "report": report.as_dict(),
                },
            )

        # Event id from body if this was Event Grid
        event_id = None
        if isinstance(body, list) and body:
            event_id = body[0].get("id")

        build_sha = build_script_sha()
        history_blob, output_md5 = write_snapshot_outputs(
            month=month,
            snapshot_json=snap_bytes,
            event_id=event_id,
            source_md5s=source_md5s,
            build_sha=build_sha,
        )

        write_marker(month, {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "output_md5": output_md5,
            "history_blob": history_blob,
            "app_version": APP_VERSION,
        })

        duration = (datetime.now(timezone.utc) - started).total_seconds()
        return {
            "month": month,
            "triggered": True,
            "forced": force,
            "output_md5": output_md5,
            "history_blob": history_blob,
            "source_file_md5s": source_md5s,
            "build_script_md5": build_sha,
            "anomaly_report": report.as_dict(),
            "duration_seconds": duration,
        }
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Pipeline failed for %s", month)
        raise HTTPException(500, detail={
            "month": month,
            "reason": "pipeline_exception",
            "message": str(exc),
            "traceback": traceback.format_exc(limit=6),
        })
    finally:
        try:
            shutil.rmtree(workdir)
        except Exception:  # noqa: BLE001
            pass
