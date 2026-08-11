"""Unit tests for ``_find_source`` glob tolerance in ``scripts/build-snapshot.py``.

These exercise:

* the RPA naming convention (``HUD_National_Totals_*.xlsx`` etc.),
* the ``.xlsx``-over-``.xls`` preference tiebreaker, and
* the ``FileNotFoundError`` branch, which must list every glob it tried.
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest


SCRIPTS_DIR = Path(__file__).resolve().parent.parent
BUILD_SCRIPT = SCRIPTS_DIR / "build-snapshot.py"


def _load_build_snapshot(source_root: Path):
    """Import ``scripts/build-snapshot.py`` as a module.

    The filename contains a hyphen so it can't be imported normally.
    We also set ``SNAPSHOT_SOURCE_ROOT`` before import so module-level
    constants pick it up.
    """
    os.environ["SNAPSHOT_SOURCE_ROOT"] = str(source_root)
    # Force a fresh import so SOURCE_ROOT reflects the current env.
    mod_name = "build_snapshot_under_test"
    sys.modules.pop(mod_name, None)
    spec = importlib.util.spec_from_file_location(mod_name, str(BUILD_SCRIPT))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


@pytest.fixture()
def period_dir(tmp_path: Path) -> Path:
    """Populate a fake ``data/source/2026-06/`` with RPA-shaped filenames."""
    period = "2026-06"
    src = tmp_path / period
    src.mkdir(parents=True)
    # Zero-byte fixtures — _find_source only cares about paths, not content.
    for name in (
        "HUD_National_Totals_6.30.26.xlsx",     # hud_total_compare_ratios (RPA)
        "HOCs_6.30.26.xlsx",                    # hoc_compare_ratios         (RPA)
        "HUD_Office_6.30.26.xlsx",              # hud_field_offices          (RPA)
        "Branches_6.30.26.xlsx",                # hud_branches               (RPA)
        "NW_Data_as_of_6.30.26.xlsx",           # nw_data                    (RPA)
    ):
        (src / name).touch()
    return src


def test_find_source_matches_rpa_naming(tmp_path: Path, period_dir: Path) -> None:
    bs = _load_build_snapshot(tmp_path)

    got = {
        "hud_total_compare_ratios": bs._find_source("2026-06", "hud_total_compare_ratios").name,
        "hoc_compare_ratios":       bs._find_source("2026-06", "hoc_compare_ratios").name,
        "hud_field_offices":        bs._find_source("2026-06", "hud_field_offices").name,
        "hud_branches":             bs._find_source("2026-06", "hud_branches").name,
        "nw_data":                  bs._find_source("2026-06", "nw_data").name,
    }
    assert got == {
        "hud_total_compare_ratios": "HUD_National_Totals_6.30.26.xlsx",
        "hoc_compare_ratios":       "HOCs_6.30.26.xlsx",
        "hud_field_offices":        "HUD_Office_6.30.26.xlsx",
        "hud_branches":             "Branches_6.30.26.xlsx",
        "nw_data":                  "NW_Data_as_of_6.30.26.xlsx",
    }


def test_find_source_prefers_xlsx_over_xls(tmp_path: Path) -> None:
    """When both extensions match, ``.xlsx`` wins the tiebreaker."""
    period = "2026-05"
    src = tmp_path / period
    src.mkdir(parents=True)
    # Two candidates for the same slot: HUD's .xls export AND a newer .xlsx.
    (src / "HUD_Total_Compare_Ratio_5.31.26.xls").touch()
    (src / "HUD_National_Totals_5.31.26.xlsx").touch()

    bs = _load_build_snapshot(tmp_path)
    chosen = bs._find_source(period, "hud_total_compare_ratios")
    assert chosen.suffix.lower() == ".xlsx", (
        f".xlsx should win over .xls; got {chosen.name!r}"
    )
    assert chosen.name == "HUD_National_Totals_5.31.26.xlsx"


def test_find_source_missing_raises_with_all_candidates(tmp_path: Path) -> None:
    """The error message must list every glob the resolver tried."""
    period = "2026-06"
    (tmp_path / period).mkdir(parents=True)

    bs = _load_build_snapshot(tmp_path)
    with pytest.raises(FileNotFoundError) as exc:
        bs._find_source(period, "hud_total_compare_ratios")

    msg = str(exc.value)
    # Every alias for the hud_total_compare_ratios slot should show up in the
    # error \u2014 not just the first one \u2014 so operators can see what the script
    # expected vs. what RPA uploaded.
    for glob in bs.SLOT_ALIAS_TABLE["hud_total_compare_ratios"]:
        assert glob in msg, f"missing candidate glob in error: {glob!r}\n{msg}"
