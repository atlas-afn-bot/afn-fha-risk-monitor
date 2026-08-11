"""Lint: every local sibling module imported by build-snapshot.py must have
a matching COPY line in the container Dockerfile.

This is a text-only check — it does not exec docker or the image. It exists
because we've been bitten twice: build-snapshot.py gains a `from build_XXX
import ...` line, the Dockerfile is not updated, and the container crashes
at runtime with ImportError.

If this test fails, add a `COPY --chown=pipeline:pipeline scripts/build_XXX.py
/opt/repo/scripts/build_XXX.py` line to the Dockerfile.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BUILD_SNAPSHOT = REPO_ROOT / "scripts" / "build-snapshot.py"
DOCKERFILE = REPO_ROOT / "infra" / "snapshot-pipeline" / "container" / "Dockerfile"

# Modules that are third-party / stdlib and are NOT expected to be COPY'd.
# (stdlib is inexhaustible; we filter by the "starts with build_" convention
# for local siblings.)
LOCAL_MODULE_PREFIX = "build_"


def _sibling_imports() -> set[str]:
    """Return set of local sibling module names imported by build-snapshot.py."""
    src = BUILD_SNAPSHOT.read_text(encoding="utf-8")
    # Match: "import build_X" or "from build_X import ..."
    # Allow leading whitespace so lazy/nested imports count too.
    pat = re.compile(
        r"^\s*(?:from|import)\s+(" + LOCAL_MODULE_PREFIX + r"[a-zA-Z0-9_]+)\b",
        re.MULTILINE,
    )
    return set(pat.findall(src))


def _dockerfile_copied_modules() -> set[str]:
    """Return set of local sibling module names that have a COPY line."""
    df = DOCKERFILE.read_text(encoding="utf-8")
    # Match: "COPY ... scripts/build_XXX.py ..."
    pat = re.compile(
        r"COPY\b[^\n]*\bscripts/(" + LOCAL_MODULE_PREFIX + r"[a-zA-Z0-9_]+)\.py\b"
    )
    return set(pat.findall(df))


def test_every_sibling_import_has_a_copy_line() -> None:
    imported = _sibling_imports()
    copied = _dockerfile_copied_modules()
    missing = imported - copied
    assert not missing, (
        f"build-snapshot.py imports local sibling module(s) {sorted(missing)} "
        f"that are NOT COPY'd into the container image. Add a "
        f"'COPY --chown=pipeline:pipeline scripts/<mod>.py /opt/repo/scripts/<mod>.py' "
        f"line to {DOCKERFILE.relative_to(REPO_ROOT)}."
    )


def test_build_snapshot_itself_is_copied() -> None:
    """Sanity: build-snapshot.py must itself have a COPY line."""
    df = DOCKERFILE.read_text(encoding="utf-8")
    assert re.search(
        r"COPY\b[^\n]*\bscripts/build-snapshot\.py\b", df
    ), "Dockerfile is missing the COPY line for scripts/build-snapshot.py."
