#!/usr/bin/env python3
"""
Build a monthly FHA Risk Monitor snapshot JSON from the 6 Excel source files.

Usage:
    python3 scripts/build-snapshot.py <period>

where <period> is a YYYY-MM key matching the folder under data/source/.

Reads:
    data/source/<period>/HUD Total Compare Ratios *.xlsx
    data/source/<period>/HOC Compare Ratios - *.xlsx
    data/source/<period>/HUD Field Offices - *.xlsx
    data/source/<period>/HUD Branches - *.xlsx
    data/source/<period>/NW Data *.xlsx
    data/source/<period>/Neighborhood Watch Report <period> *Enc Data.xlsx

Writes:
    public/data/snapshots/<period>.json
    public/data/snapshots/index.json       (appended / updated)

The script is idempotent — rerunning replaces the output cleanly.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import math
import os
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import openpyxl
import pandas as pd

SCHEMA_VERSION = 1
SCRIPT_VERSION = "1.0"
REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_ROOT = REPO_ROOT / "data" / "source"
SNAPSHOT_DIR = REPO_ROOT / "public" / "data" / "snapshots"

# Canonical HUD Office → HOC map (from db/migrations/001_initial_schema.sql)
HUD_OFFICE_HOC: Dict[str, str] = {
    # Atlanta
    "Atlanta": "Atlanta", "Birmingham": "Atlanta", "Caribbean": "Atlanta",
    "Columbia": "Atlanta", "Coral Gables": "Atlanta", "Greensboro": "Atlanta",
    "Jackson": "Atlanta", "Jacksonville": "Atlanta", "Knoxville": "Atlanta",
    "Louisville": "Atlanta", "Memphis": "Atlanta", "Miami": "Atlanta",
    "Nashville": "Atlanta", "Orlando": "Atlanta", "San Juan": "Atlanta",
    "Tampa": "Atlanta",
    # Denver
    "Albuquerque": "Denver", "Casper": "Denver", "Dallas": "Denver",
    "Denver": "Denver", "Des Moines": "Denver", "Fargo": "Denver",
    "Fort Worth": "Denver", "Helena": "Denver", "Houston": "Denver",
    "Kansas City": "Denver", "Little Rock": "Denver", "Lubbock": "Denver",
    "Minneapolis": "Denver", "New Orleans": "Denver", "Oklahoma City": "Denver",
    "Omaha": "Denver", "Rapid City": "Denver", "Salt Lake City": "Denver",
    "San Antonio": "Denver", "Shreveport": "Denver", "Sioux Falls": "Denver",
    "Springfield": "Denver", "St. Louis": "Denver", "Tulsa": "Denver",
    "Wichita": "Denver",
    # Philadelphia
    "Albany": "Philadelphia", "Baltimore": "Philadelphia", "Bangor": "Philadelphia",
    "Boston": "Philadelphia", "Buffalo": "Philadelphia", "Burlington": "Philadelphia",
    "Charleston": "Philadelphia", "Charlotte": "Philadelphia", "Chicago": "Philadelphia",
    "Cincinnati": "Philadelphia", "Cleveland": "Philadelphia", "Columbus": "Philadelphia",
    "Detroit": "Philadelphia", "Flint": "Philadelphia", "Grand Rapids": "Philadelphia",
    "Hartford": "Philadelphia", "Indianapolis": "Philadelphia", "Manchester": "Philadelphia",
    "Milwaukee": "Philadelphia", "Newark": "Philadelphia", "New York": "Philadelphia",
    "Philadelphia": "Philadelphia", "Pittsburgh": "Philadelphia", "Providence": "Philadelphia",
    "Richmond": "Philadelphia", "Washington, DC": "Philadelphia",
    # Santa Ana
    "Anchorage": "Santa Ana", "Boise": "Santa Ana", "Fresno": "Santa Ana",
    "Honolulu": "Santa Ana", "Las Vegas": "Santa Ana", "Los Angeles": "Santa Ana",
    "Phoenix": "Santa Ana", "Portland": "Santa Ana", "Reno": "Santa Ana",
    "Sacramento": "Santa Ana", "San Diego": "Santa Ana", "San Francisco": "Santa Ana",
    "Santa Ana": "Santa Ana", "Seattle": "Santa Ana", "Spokane": "Santa Ana",
    "Tucson": "Santa Ana",
}

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _clean_num(v: Any) -> Optional[float]:
    """Return a finite float or None — normalizes Excel empties / strings."""
    if v is None:
        return None
    if isinstance(v, bool):
        return None  # avoid True/False sneaking in as 1/0
    if isinstance(v, (int, float)):
        if isinstance(v, float) and math.isnan(v):
            return None
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _clean_int(v: Any) -> Optional[int]:
    f = _clean_num(v)
    if f is None:
        return None
    return int(f)


def _clean_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    # Reject pandas NaN floats (they stringify to "nan")
    if isinstance(v, float) and math.isnan(v):
        return None
    s = str(v).strip()
    if not s:
        return None
    # Reject literal "nan"/"NaT" strings produced by pandas coercion
    if s.lower() in {"nan", "nat", "none"}:
        return None
    return s


def _case_norm(v: Any) -> Optional[str]:
    """Normalize FHA case number so Encompass (010-1234567) matches HUD (010-1234567)."""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    # Strip trailing spaces / zero-pad nothing — just return as-is uppercased
    return s.upper()


def _find_source(period: str, pattern: str) -> Path:
    """Locate a source Excel under data/source/{period}/ by glob."""
    base = SOURCE_ROOT / period
    candidates = sorted(base.glob(pattern))
    if not candidates:
        raise FileNotFoundError(f"No file matches {pattern!r} in {base}")
    return candidates[0]


def _title_case_office(name: str) -> str:
    """Normalize HUD office name for HOC lookup (HUD exports are padded uppercase)."""
    s = name.strip().title()
    # HUD exports "WASHINGTON, DC" etc. — preserve the DC
    s = s.replace("Dc", "DC").replace("Usa", "USA")
    return s


def _match_hoc(office_name: str) -> Optional[str]:
    return HUD_OFFICE_HOC.get(_title_case_office(office_name))


def _parse_performance_period(raw_cell: str) -> Tuple[str, str]:
    """Extract an ISO date and window label from the Performance Period cell.

    Accepts strings like:
        "Performance Period - 02/28/2026"
        "Data shown includes all insured single family loans with beginning amortization date between March 1, 2024 and February 28, 2026"
    """
    raw = raw_cell.strip()
    # MM/DD/YYYY
    import re
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", raw)
    if m:
        mm, dd, yyyy = m.groups()
        iso = f"{yyyy}-{mm}-{dd}"
        return iso, raw
    # "between X and Y"
    m = re.search(r"between\s+(.+?)\s+and\s+(.+?)$", raw, re.IGNORECASE)
    if m:
        end = m.group(2).strip().rstrip(".")
        # Expect "February 28, 2026"
        m2 = re.match(r"(\w+)\s+(\d+),?\s+(\d{4})", end)
        if m2:
            mon, day, yr = m2.group(1), m2.group(2), m2.group(3)
            mnum = MONTH_NAMES.index(mon) + 1 if mon in MONTH_NAMES else 1
            return f"{yr}-{mnum:02d}-{int(day):02d}", f"{m.group(1).strip()} — {end}"
    return "", raw


# ─────────────────────────────────────────────────────────────────────────────
# Readers — each returns a list-of-dicts in the snapshot shape
# ─────────────────────────────────────────────────────────────────────────────

def read_compare_ratios_total(path: Path) -> Tuple[List[dict], str, str]:
    """Return (rows, iso_date, window_label) from the Total Compare Ratios file."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    perf_date, perf_label = "", ""
    for r in rows:
        if not r or not r[0]:
            continue
        text = str(r[0])
        low = text.lower()
        if "performance period" in low or "amortization date between" in low:
            iso, lbl = _parse_performance_period(text)
            if iso and not perf_date:
                perf_date = iso
            # The "between March 1, 2024 and February 28, 2026" row yields the
            # richest window label; prefer it when available.
            if lbl and ("—" in lbl or " and " in lbl.lower()) and not perf_label:
                perf_label = lbl

    # Header is row 8 (index 7), data at row 9 (index 8)
    if len(rows) < 9:
        raise RuntimeError(f"{path}: expected 9+ rows, got {len(rows)}")
    data = rows[8]

    total = {
        "scope": "total",
        "compare_ratio": _clean_num(data[0]),
        "mix_adjusted_sdq": _clean_num(data[26]) if len(data) > 26 else None,
        "fha_benchmark_sdq": _clean_num(data[28]) if len(data) > 28 else None,
        "supplemental_metric": _clean_num(data[25]) if len(data) > 25 else None,
        "loans_count": _clean_int(data[3]),
        "delinquent_count": _clean_int(data[4]),
    }
    retail = {
        "scope": "retail",
        "compare_ratio": _clean_num(data[1]),
        "mix_adjusted_sdq": None,
        "fha_benchmark_sdq": None,
        "supplemental_metric": None,
        "loans_count": _clean_int(data[7]),
        "delinquent_count": _clean_int(data[9]),
    }
    sponsor = {
        "scope": "sponsor",
        "compare_ratio": _clean_num(data[2]),
        "mix_adjusted_sdq": None,
        "fha_benchmark_sdq": None,
        "supplemental_metric": None,
        "loans_count": _clean_int(data[12]),
        "delinquent_count": _clean_int(data[14]),
    }
    return [total, retail, sponsor], perf_date, perf_label


def read_compare_ratios_hoc(path: Path) -> List[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    out: List[dict] = []
    # Header row 8 (index 7); data rows start at index 8
    for r in rows[8:]:
        if not r or not r[0]:
            continue
        name = str(r[0]).strip().title()
        if name not in {"Atlanta", "Denver", "Philadelphia", "Santa Ana"}:
            continue
        out.append({
            "hoc_name": name,
            "compare_ratio": _clean_num(r[1]),
            "retail_ratio": _clean_num(r[2]),
            "sponsor_ratio": _clean_num(r[3]),
            "mix_adjusted_sdq": None,     # not in HOC file
            "fha_benchmark_sdq": None,
            "supplemental_metric": None,
            "loans_count": _clean_int(r[4]),
            "delinquent_count": _clean_int(r[5]),
        })
    return out


def read_compare_ratios_hud_office(path: Path) -> List[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    # Find header
    header_idx = -1
    for i, r in enumerate(rows[:20]):
        if r and r[0] and "HUD OFFICE" in str(r[0]).upper() and len(r) > 1 \
                and "COMPARE RATIO" in str(r[1] or "").upper():
            header_idx = i
            break
    if header_idx < 0:
        raise RuntimeError(f"{path}: no header row found")

    out: List[dict] = []
    for r in rows[header_idx + 1:]:
        if not r or not r[0]:
            continue
        name = str(r[0]).strip()
        upper = name.upper()
        if upper.startswith(("REPORT", "OUTPUT", "LOAN TYPE", "DATA SHOWN")):
            continue
        canonical = _title_case_office(name)
        out.append({
            "hud_office": canonical,
            "hoc": _match_hoc(canonical),
            "retail_branches_count": _clean_int(r[7]),
            "sponsored_branches_count": _clean_int(r[12]),
            "compare_ratio": _clean_num(r[1]),
            "retail_ratio": _clean_num(r[2]),
            "sponsor_ratio": _clean_num(r[3]),
            "loans_count": _clean_int(r[4]),
            "delinquent_count": _clean_int(r[5]),
            "retail_loans": _clean_int(r[8]),
            "retail_delinquent": _clean_int(r[10]),
            "sponsored_loans": _clean_int(r[13]),
            "sponsored_delinquent": _clean_int(r[15]),
            "hud_office_dq_pct": _clean_num(r[19]),
            "area_retail_dq_pct": _clean_num(r[22]),
            "area_sponsored_dq_pct": _clean_num(r[25]),
            "mix_adjusted_sdq": _clean_num(r[27]) if len(r) > 27 else None,
            "fha_benchmark_sdq": _clean_num(r[29]) if len(r) > 29 else None,
            "supplemental_metric": _clean_num(r[26]) if len(r) > 26 else None,
        })
    return out


def read_compare_ratios_branch(path: Path) -> List[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    # Header row 8 (index 7) starts with "Retail Branch"
    header_idx = -1
    for i, r in enumerate(rows[:20]):
        if r and r[0] and "RETAIL BRANCH" in str(r[0]).upper():
            header_idx = i
            break
    if header_idx < 0:
        raise RuntimeError(f"{path}: no branch header found")

    out: List[dict] = []
    for r in rows[header_idx + 1:]:
        if not r or r[0] is None:
            continue
        nmls = _clean_str(r[0])
        if not nmls:
            continue
        # Branch NMLS IDs are 10-digit numeric strings (e.g. '1835202534').
        # Reject any row where col 0 isn't a clean numeric id — that filters
        # out the sheet footer ("(K) = Cumulative...") and any stray rows.
        nmls_digits = nmls.replace(" ", "")
        if not nmls_digits.isdigit():
            continue
        # Approval status must be 'A' or 'T'; anything else means it's not a
        # real branch row.
        approval = _clean_str(r[1])
        if approval not in ("A", "T"):
            continue
        out.append({
            "nmls_id": nmls_digits,
            "branch_name": None,  # not present in the drill-down sheet
            "hud_office": None,   # needs separate NW Branch by Office sheet (phase 2)
            "approval_status": approval,
            "loans_underwritten": _clean_int(r[3]),
            "delinquency_rate": _clean_num(r[8]),
            "compare_ratio": _clean_num(r[2]),
        })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Encompass + NW Data 2 (loans)
# ─────────────────────────────────────────────────────────────────────────────

def _read_nw_data2(path: Path) -> pd.DataFrame:
    """Read `NW Data 2.28.26.xlsx` as a DataFrame keyed by Case Number."""
    # Header is row 9 (index 8); data starts row 10
    df = pd.read_excel(path, sheet_name=0, header=8, engine="openpyxl")
    df.columns = [str(c).strip() for c in df.columns]
    if "Case Number" not in df.columns:
        raise RuntimeError(f"{path}: expected 'Case Number' column, got {list(df.columns)[:5]}")
    df["Case Number"] = df["Case Number"].astype(str).str.strip().str.upper()
    return df


def _read_encompass(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=0, engine="openpyxl")
    df.columns = [str(c).strip() for c in df.columns]
    df["Case #"] = df["Case #"].astype(str).str.strip().str.upper()
    return df


def _to_bool(val: Any) -> bool:
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        if isinstance(val, float) and math.isnan(val):
            return False
        return val != 0
    s = str(val).strip().lower()
    return s in {"yes", "y", "true", "1"}


def _normalize_program(raw: str) -> str:
    s = (raw or "").strip().lower()
    if not s:
        return "Non-DPA"
    if "boost" in s:
        return "Boost"
    if "arrive" in s or "aurora" in s:
        return "Arrive/Aurora"
    return raw.strip()


def _pick(row: dict, *keys: str, default=None):
    for k in keys:
        if k in row:
            v = row[k]
            if v is None:
                continue
            if isinstance(v, float) and math.isnan(v):
                continue
            if isinstance(v, str) and not v.strip():
                continue
            return v
    return default


def _fails_enhanced_guidelines(fico: float, units: int, aus: str, reserves: float,
                               gift_amount: float, pay_shock_over_100: bool,
                               is_boost: bool) -> bool:
    if not is_boost:
        return False
    aus_upper = (aus or "").upper().strip()
    is_manual = "MANUAL" in aus_upper
    is_auto = aus_upper in ("DU", "LP") or (aus_upper != "" and not is_manual)

    if fico and fico < 640:
        return True
    if units and units >= 3:
        return True

    has_gift = (gift_amount or 0) > 0
    if is_auto:
        if fico < 680:
            if (reserves or 0) < 2:
                return True
            if has_gift:
                return True
        else:
            if (reserves or 0) < 1:
                return True
    if is_manual:
        if fico >= 680:
            if (reserves or 0) < 1:
                return True
            if has_gift:
                return True
        else:
            if (reserves or 0) < 3:
                return True
            if has_gift:
                return True
            if pay_shock_over_100:
                return True
    return False


def build_loans(enc_path: Path, nw2_path: Path,
                hud_office_lookup: Dict[str, dict]) -> List[dict]:
    print(f"  Loading Encompass: {enc_path.name}")
    enc = _read_encompass(enc_path)
    print(f"    {len(enc):,} rows × {len(enc.columns)} cols")

    print(f"  Loading NW Data 2: {nw2_path.name}")
    nw2 = _read_nw_data2(nw2_path)
    print(f"    {len(nw2):,} rows × {len(nw2.columns)} cols")

    # Left-join on Case #
    nw2_small = nw2[[c for c in [
        "Case Number", "FHA Ins Stat", "Term", "Liv Units", "Loan Purpose",
        "Mortgage Amount", "Interest Rate", "Front Ratio", "Back Ratio",
        "Loan To Value Ratio", "Credit Score", "Underwriter Name", "Unwtr ID",
        "Seriously Delinquent", "Oldest Unpaid Installment Due Date",
        "Number of Months Delinquent", "Delinquent Status", "Delinquent Reason",
        "Loan Officer NMLS ID", "Indem",
        # NW Data extension fields (sponsor / TPO, gift letter, census,
        # underwriter review, indemnification). Merged onto every loan
        # so downstream rollups can be computed from the canonical loan
        # array.
        "Sponsor ID", "Sponsored Originator Name",
        "Sponsored Originator EIN ID (last 4 digits)",
        "Sponsored Originator NMLS ID",
        "Gift Ltr Amt", "Gift Ltr Source",
        "Census Tract", "Underserved Indicator",
        "Unwtr Rvw Appr", "Unwtr Mort Cr Rtng",
        "Delinquent Status Date",
        "Payments before First 90 Day Delinquent Reported",
    ] if c in nw2.columns]].copy()
    nw2_small = nw2_small.rename(columns={"Case Number": "Case #"})
    merged = enc.merge(nw2_small, how="left", on="Case #", suffixes=("", "_nw"))
    print(f"    joined: {len(merged):,} rows")

    loans: List[dict] = []
    for idx, row in merged.iterrows():
        row = row.to_dict()

        fico = _clean_num(row.get("FICO")) or 0
        units_val = _clean_int(row.get("Subject Property # Units")) or 0
        front_dti = _clean_num(row.get("Top Ratio"))
        back_dti = _clean_num(row.get("Bottom Ratio"))
        ltv = _clean_num(row.get("LTV"))
        reserves_months = _clean_num(row.get("Reserves")) or 0
        gift_amount = _clean_num(row.get("Gift Fund Amount")) or 0
        payment_shock = _clean_num(row.get("Payment Shock"))
        pay_shock_over_100_flag = str(row.get("Pay Shock > 100") or "").strip().lower() == "yes"

        raw_program = str(row.get("Loan Program") or "")
        is_dpa = "DPA" in raw_program.upper()
        dpa_program_norm = _normalize_program(str(row.get("DPA Program") or ""))
        is_boost = is_dpa and "boost" in str(row.get("DPA Program") or "").lower()

        dq_yes = str(row.get("DQ") or "").strip().lower() == "yes"
        sdq_yes = str(row.get("Seriously Delinquent") or "").strip().lower() == "yes"
        status_code = str(row.get("HUD Status Code") or "").strip().upper()
        is_claim = dq_yes and status_code in {"C", "CLAIM", "9"}

        channel_raw = str(row.get("Loan Info Channel") or "").lower()
        if "retail" in channel_raw:
            channel = "Retail"
        elif "wholesale" in channel_raw:
            channel = "Wholesale"
        else:
            channel = None

        hud_office = _clean_str(row.get("HUD Office"))
        hud_office_norm = _title_case_office(hud_office) if hud_office else None
        hoc = _match_hoc(hud_office_norm) if hud_office_norm else _clean_str(row.get("HOC"))

        variable_pct = _clean_num(row.get("Variable Income %")) or 0
        has_variable = str(row.get("Variable Income (Y/N)") or "").strip().lower() == "y"
        has_super_var = variable_pct > 25

        manufactured_flag = _to_bool(row.get("Manufactured")) or _to_bool(row.get("RISK: Manufactured Home"))
        manual_uw = "MANUAL" in (str(row.get("Underwriting Risk Assess Type") or "")).upper()

        hud_def = _to_bool(row.get("HUDVA Condition 1")) or _to_bool(row.get("HUDVA UW Condition 1"))
        gift_grant = (_clean_num(row.get("Total Gifts and Grants")) or 0) > 0 \
            or str(row.get("Gift or Grant (Y/N)") or "").strip().lower() == "y"

        non_owner = _to_bool(row.get("Non-Owner Occupied Borrower"))

        # Risk indicator bit flags
        has_sub_620 = fico > 0 and fico < 620
        has_super_29_dti = (front_dti or 0) > 29
        has_super_50_dti = (back_dti or 0) > 50
        has_super_90_ltv = (ltv or 0) > 90
        has_super_95_ltv = (ltv or 0) > 95

        # Use RPA-supplied Risk Indicator Count when available; else recompute
        risk_count = _clean_int(row.get("Risk Indicator Count"))
        if risk_count is None:
            risk_count = sum(int(b) for b in (
                has_sub_620, has_super_29_dti, has_super_50_dti,
                has_super_90_ltv, has_super_95_ltv, is_dpa,
                manufactured_flag, has_variable, has_super_var,
                non_owner, manual_uw, hud_def, gift_grant,
            ))

        fails_eg = _fails_enhanced_guidelines(
            fico=fico, units=units_val, aus=str(row.get("Underwriting Risk Assess Type") or ""),
            reserves=reserves_months, gift_amount=gift_amount,
            pay_shock_over_100=pay_shock_over_100_flag, is_boost=is_boost,
        )

        # Occupancy / property
        occupancy = _clean_str(row.get("Occupancy Borr Pair 1"))
        property_type = _clean_str(row.get("Property Type Master")) or _clean_str(row.get("HUD 92900 LT Subject Property Type"))

        loan_id = str(row.get("Loan Number") or row.get("Case #") or f"row-{idx}").strip()

        loans.append({
            "loan_id": loan_id,
            "fha_case_number": _clean_str(row.get("Case #")),

            "loan_officer": _clean_str(row.get("Loan Officer - Retail")),
            # Prefer Encompass's LO Employee ID — AFN's canonical LO id,
            # populated for every loan. `Loan Officer NMLS ID` comes from
            # the NW Data 2 join (only ~5% of loans = delinquent ones)
            # and would shatter each LO into many single-loan buckets.
            "lo_nmls_id": _clean_str(row.get("LO Employee ID")) or _clean_str(row.get("Loan Officer NMLS ID")),
            "branch_nmls_id": _clean_str(row.get("Org ID")) or _clean_str(row.get("Broker Lender Company ID")),
            "tpo_broker": _clean_str(row.get("TPO Broker")),
            "broker": _clean_str(row.get("Broker")),
            "branch_name": _clean_str(row.get("Branch Name")),
            "branch_name_retail": _clean_str(row.get("Branch Name - Retail")),
            "hud_office": hud_office_norm,
            "hoc": hoc,
            "channel": channel,

            "dpa_program": dpa_program_norm,
            "dpa_name": _clean_str(row.get("DPA Name")),
            "dpa_investor": _clean_str(row.get("DPA Investor")),
            "investor_name": _clean_str(row.get("Investor Name")),
            "loan_purpose": _clean_str(row.get("Loan Purpose")),

            "fico_score": int(fico) if fico else None,
            "front_dti": front_dti,
            "back_dti": back_dti,
            "ltv": ltv,
            "loan_amount": _clean_num(row.get("Total Loan Amount")) or _clean_num(row.get("Mortgage Amount")),
            "source_of_funds": _clean_str(row.get("Source of Funds")),
            "employment_type": _clean_str(row.get("Self Employed (Y/N)")),
            "aus": _clean_str(row.get("Underwriting Risk Assess Type")),
            "units": units_val or None,
            "property_type": property_type,
            "occupancy": occupancy,

            "delinquent_status_code": _clean_str(row.get("HUD Status Code")),
            "delinquent_status": _clean_str(row.get("Status")) or _clean_str(row.get("Delinquent Status")),
            "months_delinquent": _clean_int(row.get("Number of Months Delinquent")),
            "oldest_unpaid_installment": _iso_date(row.get("Oldest Unpaid Installment Due Date")),
            "fha_ins_stat": _clean_str(row.get("FHA Ins Stat")),

            "has_sub_620": bool(has_sub_620),
            "has_super_29_dti": bool(has_super_29_dti),
            "has_super_50_dti": bool(has_super_50_dti),
            "has_super_90_ltv": bool(has_super_90_ltv),
            "has_super_95_ltv": bool(has_super_95_ltv),
            "has_dpa": bool(is_dpa),
            "has_manufactured": bool(manufactured_flag),
            "has_variable_income": bool(has_variable),
            "has_super_variable_income": bool(has_super_var),
            "has_non_owner_occupied": bool(non_owner),
            "has_manual_uw": bool(manual_uw),
            "has_hud_deficiency": bool(hud_def),
            "has_gift_grant": bool(gift_grant),
            "risk_indicator_count": int(risk_count) if risk_count is not None else 0,

            "is_delinquent": bool(dq_yes),
            "is_seriously_delinquent": bool(sdq_yes or dq_yes),
            "is_claim": bool(is_claim),

            "loan_program_raw": _clean_str(raw_program),
            "ltv_group": _clean_str(row.get("LTV Group")),
            "fthb": _clean_str(row.get("FTHB")),
            "dti_back_end_group": _clean_str(row.get("DTI Back End Group")),
            "payment_shock_group": _clean_str(row.get("Payment Shock Group")),
            "source_of_funds_group": _clean_str(row.get("Source of Funds Group")),
            "reserves_group": _clean_str(row.get("Reserves Group")),
            "gift_grant_group": _clean_str(row.get("% Funds from Gift or Grant Group")),
            "reserves_months": reserves_months if reserves_months else None,
            "gift_fund_amount": gift_amount if gift_amount else None,
            "payment_shock": payment_shock,
            "pay_shock_over_100": _clean_str(row.get("Pay Shock > 100")),
            "is_boost": bool(is_boost),
            "fails_enhanced_guidelines": bool(fails_eg),
            "hud_office_compare_ratio": _clean_num(row.get("HUD Office Compare Ratio")),
            "program_type": "DPA" if is_dpa else "Standard",

            # ── NW Data extension fields (additive; may be None when the
            # Encompass row didn't match a NW Data 2 row on Case #) ──
            "underwriter_name": _clean_str(row.get("Underwriter Name")),
            "underwriter_id": _clean_str(row.get("Unwtr ID")),
            "underwriter_review_approval": _clean_str(row.get("Unwtr Rvw Appr")),
            "underwriter_mortgage_credit_rating": _clean_str(row.get("Unwtr Mort Cr Rtng")),
            "sponsor_id": _clean_str(row.get("Sponsor ID")),
            "sponsor_originator_name": _clean_str(row.get("Sponsored Originator Name")),
            "sponsor_originator_ein_last4": _clean_str(row.get("Sponsored Originator EIN ID (last 4 digits)")),
            "sponsor_originator_nmls_id": _clean_str(row.get("Sponsored Originator NMLS ID")),
            "gift_letter_amount": _clean_num(row.get("Gift Ltr Amt")),
            "gift_letter_source": _clean_str(row.get("Gift Ltr Source")),
            "census_tract": _clean_str(row.get("Census Tract")),
            "underserved_indicator": _clean_str(row.get("Underserved Indicator")),
            "delinquent_reason_code": _clean_str(row.get("Delinquent Reason")),
            "payments_before_first_90_day_delinquent": _clean_int(
                row.get("Payments before First 90 Day Delinquent Reported")
            ),
            "indemnification_flag": _clean_str(row.get("Indem")),

            # ── Enc Data fields for Deep Dive ──
            "underwriter_enc": _clean_str(row.get("Underwriter")),
            "lo_employee_id": _clean_str(row.get("LO Employee ID")),
            "dq_status_enc": _clean_str(row.get("DQ")),
            "hud_reason_code_enc": _clean_str(row.get("HUD Reason Code")),
            "ae_name": _clean_str(row.get("AE Name")),
            "subservicer": _clean_str(row.get("Subservicer")),
            "org_id": _clean_str(row.get("Org ID")),
            "tpo_broker_flag": _clean_str(row.get("TPO Broker")),
            "funded_date": _iso_date(row.get("Fund Date")),
            "closed_date": _iso_date(row.get("Closed Date")),
            "lien_position": _clean_str(row.get("Lien Position")),
            "borrower_count": _clean_int(row.get("Borrower Count")),
            "total_income": _clean_num(row.get("Total Income")),
            "is_fthb": str(row.get("FTHB") or "").strip().lower() == "yes",
            "cltv": _clean_num(row.get("CLTV")),
            "interest_rate": _clean_num(row.get("Interest Rate")),
            "insuring_hoc": _clean_str(row.get("Insuring HOC Center")),
        })

    return loans


def _iso_date(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    s = str(v).strip()
    return s or None


# ─────────────────────────────────────────────────────────────────────────────
# Derived aggregates
# ─────────────────────────────────────────────────────────────────────────────

def _dq_pct(delinquent: int, total: int) -> Optional[float]:
    return round((delinquent / total) * 100, 4) if total > 0 else None


def _bucketize_fico(fico: Optional[int]) -> str:
    if fico is None or fico == 0:
        return "Unknown"
    if fico < 580: return "<580"
    if fico < 620: return "580-619"
    if fico < 660: return "620-659"
    if fico < 680: return "660-679"
    if fico < 700: return "680-699"
    if fico < 740: return "700-739"
    return "740+"


def _bucketize_dti(dti: Optional[float]) -> str:
    if dti is None:
        return "Unknown"
    if dti < 36: return "<36"
    if dti < 43: return "36-42.99"
    if dti < 50: return "43-49.99"
    if dti < 57: return "50-56.99"
    return "57+"


def _bucketize_ltv(ltv: Optional[float]) -> str:
    if ltv is None:
        return "Unknown"
    if ltv < 80: return "<80"
    if ltv < 90: return "80-89.99"
    if ltv < 95: return "90-94.99"
    if ltv < 97: return "95-96.99"
    return "97+"


def _bucketize_risk(n: int) -> str:
    if n >= 5:
        return "5+"
    return str(n)


def build_portfolio_slices(loans: List[dict]) -> List[dict]:
    """Generate flat (dimension, bucket) rows matching fha.portfolio_slices."""
    total = len(loans)
    total_dlq = sum(1 for l in loans if l["is_delinquent"])
    total_retail = [l for l in loans if l["channel"] == "Retail"]
    total_ws = [l for l in loans if l["channel"] == "Wholesale"]
    base_combined = _dq_pct(total_dlq, total)
    base_retail = _dq_pct(sum(1 for l in total_retail if l["is_delinquent"]), len(total_retail))
    base_wholesale = _dq_pct(sum(1 for l in total_ws if l["is_delinquent"]), len(total_ws))

    # Dimension definitions: (dimension_key, getter, bucket_order_map or None)
    def fixed_order(labels):
        return {lbl: i for i, lbl in enumerate(labels)}

    dims: List[Tuple[str, Any, Optional[Dict[str, int]]]] = [
        ("dpa_program", lambda l: l.get("dpa_program") or "Non-DPA", fixed_order(["Boost", "Arrive/Aurora", "Non-DPA"])),
        ("dpa_investor", lambda l: l.get("dpa_investor") or "Unassigned", None),
        ("channel", lambda l: l.get("channel") or "Unknown", fixed_order(["Retail", "Wholesale", "Unknown"])),
        ("fico", lambda l: _bucketize_fico(l.get("fico_score")),
         fixed_order(["<580", "580-619", "620-659", "660-679", "680-699", "700-739", "740+", "Unknown"])),
        ("front_dti", lambda l: _bucketize_dti(l.get("front_dti")),
         fixed_order(["<36", "36-42.99", "43-49.99", "50-56.99", "57+", "Unknown"])),
        ("back_dti", lambda l: _bucketize_dti(l.get("back_dti")),
         fixed_order(["<36", "36-42.99", "43-49.99", "50-56.99", "57+", "Unknown"])),
        ("ltv", lambda l: _bucketize_ltv(l.get("ltv")),
         fixed_order(["<80", "80-89.99", "90-94.99", "95-96.99", "97+", "Unknown"])),
        ("investor", lambda l: l.get("investor_name") or "Unassigned", None),
        ("hud_office", lambda l: l.get("hud_office") or "Unknown", None),
        ("source_of_funds", lambda l: l.get("source_of_funds_group") or l.get("source_of_funds") or "Unknown", None),
        ("employment", lambda l: l.get("employment_type") or "Unknown", None),
        ("aus", lambda l: l.get("aus") or "Unknown", None),
        ("loan_purpose", lambda l: l.get("loan_purpose") or "Unknown", None),
        ("units", lambda l: str(l.get("units") or "Unknown"), None),
        ("risk_indicator_count", lambda l: _bucketize_risk(l.get("risk_indicator_count") or 0),
         fixed_order(["0", "1", "2", "3", "4", "5+"])),
    ]

    rows: List[dict] = []
    for dim_key, getter, order_map in dims:
        agg: Dict[str, Dict[str, int]] = {}
        for l in loans:
            bucket = getter(l) or "Unknown"
            box = agg.setdefault(bucket, {"combined": 0, "retail": 0, "ws": 0,
                                         "cdlq": 0, "rdlq": 0, "wdlq": 0})
            box["combined"] += 1
            if l["is_delinquent"]:
                box["cdlq"] += 1
            if l["channel"] == "Retail":
                box["retail"] += 1
                if l["is_delinquent"]:
                    box["rdlq"] += 1
            elif l["channel"] == "Wholesale":
                box["ws"] += 1
                if l["is_delinquent"]:
                    box["wdlq"] += 1

        bucket_names = list(agg.keys())
        if order_map:
            bucket_names.sort(key=lambda b: (order_map.get(b, 9999), b))
        else:
            bucket_names.sort(key=lambda b: (-agg[b]["combined"], b))

        for order_idx, bucket in enumerate(bucket_names):
            box = agg[bucket]
            comb_pct = _dq_pct(box["cdlq"], box["combined"])
            ret_pct = _dq_pct(box["rdlq"], box["retail"])
            ws_pct = _dq_pct(box["wdlq"], box["ws"])
            rows.append({
                "dimension": dim_key,
                "bucket": bucket,
                "bucket_order": order_idx,
                "combined_population": box["combined"],
                "retail_population": box["retail"],
                "wholesale_population": box["ws"],
                "combined_delinquent": box["cdlq"],
                "retail_delinquent": box["rdlq"],
                "wholesale_delinquent": box["wdlq"],
                "combined_pct": comb_pct,
                "retail_pct": ret_pct,
                "wholesale_pct": ws_pct,
                "baseline_combined": base_combined,
                "baseline_retail": base_retail,
                "baseline_wholesale": base_wholesale,
                "baseline_comparison_combined":
                    round(comb_pct - base_combined, 4) if comb_pct is not None and base_combined is not None else None,
                "baseline_comparison_retail":
                    round(ret_pct - base_retail, 4) if ret_pct is not None and base_retail is not None else None,
                "baseline_comparison_wholesale":
                    round(ws_pct - base_wholesale, 4) if ws_pct is not None and base_wholesale is not None else None,
            })
    return rows


def build_loan_officer_performance(loans: List[dict]) -> List[dict]:
    total_dlq = sum(1 for l in loans if l["is_delinquent"])
    base = _dq_pct(total_dlq, len(loans))

    by_lo: Dict[str, List[dict]] = {}
    for l in loans:
        nmls = l.get("lo_nmls_id") or "unknown"
        by_lo.setdefault(nmls, []).append(l)

    out: List[dict] = []
    for nmls, group in by_lo.items():
        funded = len(group)
        dlq = sum(1 for l in group if l["is_delinquent"])
        pct = _dq_pct(dlq, funded)
        dq_group = [l for l in group if l["is_delinquent"]]

        channels = {l.get("channel") for l in group if l.get("channel")}
        channel = channels.pop() if len(channels) == 1 else None

        out.append({
            "lo_nmls_id": str(nmls),
            "lo_name": _clean_str(group[0].get("loan_officer")),
            "approval_status": None,
            "channel": channel,
            "funded_count": funded,
            "delinquent_count": dlq,
            "delinquency_pct": pct,
            "baseline_comparison": round(pct - base, 4) if pct is not None and base is not None else None,
            "sub_620_count": sum(1 for l in dq_group if l["has_sub_620"]),
            "super_29_dti_count": sum(1 for l in dq_group if l["has_super_29_dti"]),
            "super_50_dti_count": sum(1 for l in dq_group if l["has_super_50_dti"]),
            "super_90_ltv_count": sum(1 for l in dq_group if l["has_super_90_ltv"]),
            "super_95_ltv_count": sum(1 for l in dq_group if l["has_super_95_ltv"]),
            "dpa_count": sum(1 for l in dq_group if l["has_dpa"]),
            "manufactured_count": sum(1 for l in dq_group if l["has_manufactured"]),
            "variable_income_count": sum(1 for l in dq_group if l["has_variable_income"]),
            "super_variable_income_count": sum(1 for l in dq_group if l["has_super_variable_income"]),
            "non_owner_occupied_count": sum(1 for l in dq_group if l["has_non_owner_occupied"]),
            "manual_uw_count": sum(1 for l in dq_group if l["has_manual_uw"]),
            "hud_deficiency_count": sum(1 for l in dq_group if l["has_hud_deficiency"]),
            "gift_grant_count": sum(1 for l in dq_group if l["has_gift_grant"]),
        })
    out.sort(key=lambda r: -(r["delinquency_pct"] or 0))
    return out


def build_risk_indicator_distribution(loans: List[dict]) -> List[dict]:
    counts: Dict[int, Dict[str, int]] = {}
    for l in loans:
        n = min(int(l.get("risk_indicator_count") or 0), 13)
        box = counts.setdefault(n, {"loans": 0, "dlq": 0})
        box["loans"] += 1
        if l["is_delinquent"]:
            box["dlq"] += 1

    base = _dq_pct(sum(c["dlq"] for c in counts.values()), sum(c["loans"] for c in counts.values()))

    out: List[dict] = []
    for n in range(0, 14):
        box = counts.get(n, {"loans": 0, "dlq": 0})
        pct = _dq_pct(box["dlq"], box["loans"])
        out.append({
            "indicator_count": n,
            "loans_count": box["loans"],
            "delinquent_count": box["dlq"],
            "delinquency_pct": pct,
            "baseline_comparison": round(pct - base, 4) if pct is not None and base is not None else None,
        })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# NW Data extension rollups
# ─────────────────────────────────────────────────────────────────────────────

# HUD Neighborhood Watch "Delinquent Reason" code → description.
# Source: HUD Handbook 4000.1 / NW Report legend. Best-effort decoding of
# the code values observed in the NW Data 2 export. Unknown codes fall
# through to "Reason {code}".
DELINQUENT_REASON_CODES: Dict[str, str] = {
    "1":  "Death of principal mortgagor",
    "2":  "Illness of principal mortgagor",
    "3":  "Illness of mortgagor's family member",
    "4":  "Death of mortgagor's family member",
    "5":  "Marital difficulties",
    "6":  "Curtailment of income",
    "7":  "Excessive obligations",
    "8":  "Abandonment of property",
    "9":  "Distant employment transfer",
    "10": "Neighborhood problem",
    "11": "Property problem",
    "12": "Inability to sell property",
    "13": "Inability to rent property",
    "14": "Military service",
    "15": "Other",
    "16": "Unemployment",
    "17": "Business failure",
    "18": "Casualty loss",
    "19": "Energy / environment costs",
    "20": "Servicing problems",
    "21": "Payment adjustment",
    "22": "Payment dispute",
    "23": "Transfer of ownership",
    "24": "Fraud",
    "25": "Incarceration",
}


def _reason_description(code: Optional[str]) -> str:
    if not code:
        return "Not reported"
    s = str(code).strip()
    try:
        s = str(int(float(s)))
    except ValueError:
        pass
    return DELINQUENT_REASON_CODES.get(s, f"Reason {s}")


def build_underwriter_rollup(loans: List[dict]) -> List[dict]:
    """Group loans by underwriter, with SDQ count + credit-rating breakdown.

    NW Data 2 only populates `underwriter_name` for the SDQ population, so
    this rollup naturally limits itself to SDQ-touched underwriters. We skip
    the `Unassigned` bucket (loans that were never in NW Data 2).
    """
    by_uw: Dict[Tuple[str, str], List[dict]] = {}
    for l in loans:
        name = l.get("underwriter_name")
        if not name:
            continue
        uid = l.get("underwriter_id") or ""
        by_uw.setdefault((name, uid), []).append(l)

    total = len(loans)
    total_sdq = sum(1 for l in loans if l.get("is_seriously_delinquent"))
    base = _dq_pct(total_sdq, total) or 0.0

    out: List[dict] = []
    for (name, uid), group in by_uw.items():
        loan_count = len(group)
        sdq_count = sum(1 for l in group if l.get("is_seriously_delinquent"))
        sdq_pct = _dq_pct(sdq_count, loan_count)
        compare_ratio = round((sdq_pct / base) * 100, 2) if sdq_pct is not None and base > 0 else None
        rating_counts: Dict[str, int] = {}
        for l in group:
            rating = (l.get("underwriter_mortgage_credit_rating") or "").strip() or "Unrated"
            rating_counts[rating] = rating_counts.get(rating, 0) + 1
        breakdown = [
            {"rating": k, "count": v}
            for k, v in sorted(rating_counts.items(), key=lambda kv: -kv[1])
        ]
        out.append({
            "underwriter_name": name.strip(),
            "underwriter_id": uid.strip(),
            "loan_count": loan_count,
            "sdq_count": sdq_count,
            "sdq_pct": sdq_pct,
            "compare_ratio": compare_ratio,
            "mortgage_credit_rating_breakdown": breakdown,
        })
    out.sort(key=lambda r: (-r["loan_count"], r["underwriter_name"]))
    return out


def build_delinquency_reason_rollup(loans: List[dict]) -> List[dict]:
    """Group SDQ loans by HUD's Delinquent Reason code."""
    sdq = [l for l in loans if l.get("is_seriously_delinquent")]
    total_sdq = len(sdq)
    counts: Dict[str, int] = {}
    for l in sdq:
        code = (l.get("delinquent_reason_code") or "").strip() or "Not reported"
        try:
            code = str(int(float(code)))
        except ValueError:
            pass
        counts[code] = counts.get(code, 0) + 1

    out: List[dict] = []
    for code, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        pct = round((n / total_sdq) * 100, 2) if total_sdq > 0 else 0.0
        out.append({
            "reason_code": code,
            "reason_description": _reason_description(code),
            "loan_count": n,
            "pct_of_sdq": pct,
        })
    return out


def build_indemnification_loans(loans: List[dict]) -> List[dict]:
    """List loans flagged with an indemnification on the NW export."""
    out: List[dict] = []
    for l in loans:
        flag = (l.get("indemnification_flag") or "").strip()
        if not flag or flag.upper() == "N":
            continue
        out.append({
            "loan_id": l.get("loan_id"),
            "fha_case_number": l.get("fha_case_number"),
            "lo_name": l.get("loan_officer"),
            "indemnification_type": flag,
            "sdq_status": "SDQ" if l.get("is_seriously_delinquent") else "Current",
            "delinquent_status_code": l.get("delinquent_status_code"),
            "months_delinquent": l.get("months_delinquent"),
            "hud_office": l.get("hud_office"),
            "channel": l.get("channel"),
        })
    out.sort(key=lambda r: (r.get("loan_id") or ""))
    return out


def build_sponsor_tpo_detail(loans: List[dict]) -> List[dict]:
    """Per-TPO / sponsored-originator rollup from NW Data sponsor columns.

    NW Data 2 only populates the sponsor columns for the SDQ population, so
    this view is by construction an SDQ-by-TPO breakdown. The compare_ratio
    field is included for symmetry with the underwriter rollup but should
    be interpreted relative to the firm-wide SDQ rate.
    """
    by_tpo: Dict[Tuple[str, str], List[dict]] = {}
    for l in loans:
        name = l.get("sponsor_originator_name")
        if not name:
            continue
        nmls = l.get("sponsor_originator_nmls_id") or ""
        by_tpo.setdefault((name.strip(), str(nmls).strip()), []).append(l)

    total = sum(len(g) for g in by_tpo.values())
    total_sdq = sum(
        1 for g in by_tpo.values() for l in g if l.get("is_seriously_delinquent")
    )
    base = _dq_pct(total_sdq, total) or 0.0

    out: List[dict] = []
    for (name, nmls), group in by_tpo.items():
        loan_count = len(group)
        sdq_count = sum(1 for l in group if l.get("is_seriously_delinquent"))
        sdq_pct = _dq_pct(sdq_count, loan_count)
        compare_ratio = round((sdq_pct / base) * 100, 2) if sdq_pct is not None and base > 0 else None
        sample = group[0]
        out.append({
            "sponsor_originator_name": name,
            "sponsor_originator_nmls_id": nmls or None,
            "sponsor_originator_ein_last4": sample.get("sponsor_originator_ein_last4"),
            "sponsor_id": sample.get("sponsor_id"),
            "loan_count": loan_count,
            "sdq_count": sdq_count,
            "sdq_pct": sdq_pct,
            "compare_ratio": compare_ratio,
        })
    out.sort(key=lambda r: (-r["loan_count"], r["sponsor_originator_name"]))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# HUD Branch → AFN Branch Name bridge (via case number)
# ─────────────────────────────────────────────────────────────────────────────

def _enrich_branch_rows(branch_rows: List[dict], loans: List[dict],
                        nw2_path: Path) -> None:
    """Populate afn_branch_names, hud_offices, afn_org_ids on each
    compare_ratios_branch entry by bridging through NW Data case numbers
    to Encompass loan records."""
    wb = openpyxl.load_workbook(nw2_path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    header_idx = -1
    for i, r in enumerate(rows[:20]):
        if r and r[0] and "ORIGINATING" in str(r[0]).upper():
            header_idx = i
            break
    if header_idx < 0:
        print("  WARNING: could not find NW Data header for branch enrichment")
        return

    # col 0 = Originating ID (FHA Branch ID), col 7 = Case Number
    orig_to_cases: Dict[str, List[str]] = {}
    for r in rows[header_idx + 1:]:
        if not r or r[0] is None:
            continue
        orig_id = str(r[0]).strip()
        case_num = str(r[7]).strip() if r[7] else None
        if orig_id and case_num:
            orig_to_cases.setdefault(orig_id, []).append(case_num)

    case_to_info: Dict[str, dict] = {}
    for loan in loans:
        cn = loan.get("fha_case_number")
        if cn:
            case_to_info[cn] = {
                "branch_name": loan.get("branch_name"),
                "hud_office": loan.get("hud_office"),
                "org_id": loan.get("org_id") or loan.get("branch_nmls_id"),
            }

    enriched = 0
    for br in branch_rows:
        fha_id = br["nmls_id"]
        cases = orig_to_cases.get(fha_id, [])
        if not cases:
            continue

        branch_names = set()
        hud_offices = set()
        org_ids = set()
        for cn in cases:
            info = case_to_info.get(cn)
            if info:
                if info["branch_name"]:
                    branch_names.add(info["branch_name"])
                if info["hud_office"]:
                    hud_offices.add(info["hud_office"])
                if info["org_id"]:
                    org_ids.add(str(info["org_id"]))

        br["afn_branch_names"] = sorted(branch_names) if branch_names else None
        br["hud_offices"] = sorted(hud_offices) if hud_offices else None
        br["afn_org_ids"] = sorted(org_ids) if org_ids else None
        if branch_names:
            if len(branch_names) == 1:
                br["branch_name"] = list(branch_names)[0]
            else:
                br["branch_name"] = f"{len(branch_names)} AFN branches"
            enriched += 1
        if hud_offices:
            if len(hud_offices) == 1:
                br["hud_office"] = list(hud_offices)[0]
            else:
                br["hud_office"] = f"{len(hud_offices)} offices"

    print(f"  Enriched {enriched}/{len(branch_rows)} HUD branches with AFN names")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("period", help="YYYY-MM period, e.g. 2026-02")
    ap.add_argument("--out", help="Override output path", default=None)
    args = ap.parse_args()

    period = args.period
    src = SOURCE_ROOT / period
    if not src.is_dir():
        print(f"ERROR: {src} does not exist", file=sys.stderr)
        return 2

    # Pretty "February 2026"
    try:
        year, month = period.split("-")
        label = f"{MONTH_NAMES[int(month) - 1]} {year}"
    except Exception:
        label = period

    print(f"Building snapshot for {period} ({label})")

    # ── Source files ──
    total_path = _find_source(period, "HUD Total Compare Ratios*.xlsx")
    hoc_path = _find_source(period, "HOC Compare Ratios*.xlsx")
    field_path = _find_source(period, "HUD Field Offices*.xlsx")
    branches_path = _find_source(period, "HUD Branches*.xlsx")
    nw2_path = _find_source(period, "NW Data*.xlsx")
    enc_candidates = sorted(src.glob("Neighborhood Watch Report*Enc Data*.xlsx")) \
        or sorted(src.glob("*Enc Data*.xlsx"))
    if not enc_candidates:
        raise FileNotFoundError(f"No Encompass export found in {src}")
    enc_path = enc_candidates[0]

    print(f"  Total: {total_path.name}")
    print(f"  HOC:   {hoc_path.name}")
    print(f"  Field: {field_path.name}")
    print(f"  Branch: {branches_path.name}")
    print(f"  NW2:   {nw2_path.name}")
    print(f"  Enc:   {enc_path.name}")

    # ── Compare ratios ──
    print("Reading compare_ratios_total…")
    total_rows, perf_date, perf_label = read_compare_ratios_total(total_path)
    if not perf_date:
        # Fall back to last day of period month
        y, m = period.split("-")
        last_day = (dt.date(int(y), int(m) % 12 + 1, 1) - dt.timedelta(days=1)) if int(m) < 12 \
            else dt.date(int(y), 12, 31)
        perf_date = last_day.isoformat()
    print(f"  Performance period: {perf_date} — {perf_label}")

    print("Reading compare_ratios_hoc…")
    hoc_rows = read_compare_ratios_hoc(hoc_path)
    print(f"  {len(hoc_rows)} HOC rows")

    print("Reading compare_ratios_hud_office…")
    field_rows = read_compare_ratios_hud_office(field_path)
    print(f"  {len(field_rows)} HUD office rows")
    hud_office_lookup = {r["hud_office"]: r for r in field_rows}

    print("Reading compare_ratios_branch…")
    branch_rows = read_compare_ratios_branch(branches_path)
    print(f"  {len(branch_rows)} branch rows")

    # ── Loans (Encompass + NW2) ──
    print("Reading loan-level data…")
    loans = build_loans(enc_path, nw2_path, hud_office_lookup)
    print(f"  {len(loans):,} loans")

    # ── Derived aggregates ──
    print("Computing portfolio_slices…")
    slices = build_portfolio_slices(loans)
    print(f"  {len(slices)} slice rows")

    print("Computing loan_officer_performance…")
    lo_perf = build_loan_officer_performance(loans)
    print(f"  {len(lo_perf)} LOs")

    print("Computing risk_indicator_distribution…")
    risk_dist = build_risk_indicator_distribution(loans)

    print("Computing underwriter_rollup…")
    underwriter_rollup = build_underwriter_rollup(loans)
    print(f"  {len(underwriter_rollup)} underwriters")

    print("Computing delinquency_reason_rollup…")
    delinquency_reason_rollup = build_delinquency_reason_rollup(loans)
    print(f"  {len(delinquency_reason_rollup)} reason buckets")

    print("Computing indemnification_loans…")
    indemnification_loans = build_indemnification_loans(loans)
    print(f"  {len(indemnification_loans)} indemnified loans")

    print("Computing sponsor_tpo_detail…")
    sponsor_tpo_detail = build_sponsor_tpo_detail(loans)
    print(f"  {len(sponsor_tpo_detail)} sponsored originators")

    # ── Compose ──
    snapshot = OrderedDict()
    snapshot["snapshot_meta"] = {
        "period": period,
        "label": label,
        "performance_period": perf_date,
        "performance_period_label": perf_label or label,
        "generated_at": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "generated_by": f"scripts/build-snapshot.py v{SCRIPT_VERSION}",
        "source_files": [
            total_path.name, hoc_path.name, field_path.name,
            branches_path.name, nw2_path.name, enc_path.name,
        ],
        "schema_version": SCHEMA_VERSION,
        "notes": f"{len(loans):,} loans; {len(slices)} portfolio slices; {len(lo_perf)} LOs",
    }
    snapshot["compare_ratios_total"] = total_rows
    snapshot["compare_ratios_hoc"] = hoc_rows
    snapshot["compare_ratios_hud_office"] = field_rows
    # ── Enrich branch rows with AFN names + HUD offices via case-number bridge ──
    print("Enriching HUD branch rows with AFN branch names…")
    _enrich_branch_rows(branch_rows, loans, nw2_path)
    snapshot["compare_ratios_branch"] = branch_rows
    snapshot["portfolio_slices"] = slices
    snapshot["loan_officer_performance"] = lo_perf
    snapshot["risk_indicator_distribution"] = risk_dist
    snapshot["underwriter_rollup"] = underwriter_rollup
    snapshot["delinquency_reason_rollup"] = delinquency_reason_rollup
    snapshot["indemnification_loans"] = indemnification_loans
    snapshot["sponsor_tpo_detail"] = sponsor_tpo_detail
    snapshot["loans"] = loans

    # ── Write ──
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = Path(args.out) if args.out else SNAPSHOT_DIR / f"{period}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, default=str)
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"Wrote {out_path} ({size_mb:.2f} MB)")

    # ── Update index.json ──
    index_path = SNAPSHOT_DIR / "index.json"
    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            index = {"periods": [], "updated_at": "", "schema_version": SCHEMA_VERSION}
    else:
        index = {"periods": [], "updated_at": "", "schema_version": SCHEMA_VERSION}

    periods = [p for p in index.get("periods", []) if p.get("period") != period]
    periods.append({
        "period": period,
        "label": label,
        "performance_period": perf_date,
        "generated_at": snapshot["snapshot_meta"]["generated_at"],
        "file": out_path.name,
    })
    periods.sort(key=lambda p: p["period"], reverse=True)
    index["periods"] = periods
    index["updated_at"] = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    index["schema_version"] = SCHEMA_VERSION
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2)
    print(f"Updated {index_path} — {len(periods)} period(s) indexed")

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
