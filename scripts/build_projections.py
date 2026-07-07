#!/usr/bin/env python3
"""
Build the ``projections`` block for an FHA Risk Monitor snapshot.

The dashboard already computes a single-horizon ("Proposed Drop-Off Next 3
Mo") projection client-side in ``src/lib/computeData.ts``. This module
generalizes that to:

* horizons 1 / 3 / 6 months, and
* three scenarios per horizon — ``best`` / ``base`` / ``worst``.

Computation is loan-level (per Michael Kunisaki's non-negotiable spec) and
then aggregated up to office, HOC, and national. Every office-level number
is traceable to the underlying loan set exposed under ``projections.loans``.

Semantics — HUD 24-month "beginning amortization date" window
-------------------------------------------------------------

HUD reports each month with a rolling 24-month window of first-payment /
beginning-amortization dates ending at ``performance_period``.  For a
projection ``H`` months forward, the new window-start is::

    cutoff_H = (performance_period + 1 day) - (24 - H) months

A loan is projected to fall off the office denominator at horizon H iff
its ``first_payment_date`` is strictly less than ``cutoff_H``. Loans with a
missing ``first_payment_date`` are assumed to remain in-window
(conservative — never shrinks the denominator on missing data). This mirrors
``rollforwardWindowStart`` in ``src/lib/computeData.ts``.

Scenarios (Michael's ±10% delinquency lever)
--------------------------------------------

The ±10% lever is applied to the **AFN projected numerator** at every scope
(office, HOC, national). The peer benchmark used in every scope's Compare
Ratio denominator is HUD's national reference delinquency rate (the same
reference HUD uses to compute today's headline Compare Ratio) — held
constant across scenarios, horizons, and offices because HUD doesn't roll
their reference in AFN's monthly snapshot. Under this setup:

* office CR at scenario S = (office AFN dq rate under S) / (HUD national dq rate) × 100
* HOC CR at scenario S    = (HOC AFN dq rate under S)    / (HUD national dq rate) × 100
* national CR at scenario S = (AFN portfolio dq rate under S) / (HUD national dq rate) × 100

Base national CR reproduces today's headline (~150s) instead of collapsing
to 100, so committee readers can compare projections directly to the
current snapshot's Compare Ratio Total. Worst/best produce a genuine spread
at every scope. Office projected CRs are directly comparable to the HUD
Office Compare Ratios rendered in the headline dashboard (both use the
same HUD anchor).

For each office we start from the loans still in-window at horizon ``H``:

* ``base``    — projected numerator = loans still delinquent
                (base case; no delinquency change).
* ``worst``   — numerator grows by 10% of currently-non-delinquent, still-in-window
                loans (rounded to nearest whole loan).
* ``best``    — numerator shrinks by 10% of currently-delinquent, still-in-window
                loans (rounded, floored at 0).

Aggregation
-----------

* Numerator (office/HOC/national) = # AFN loans classified delinquent at
  horizon under the scenario.
* Denominator (office/HOC/national) = # AFN loans still in the
  rolled-forward 24-mo window at horizon.
* Peer benchmark = HUD's national delinquency rate, reverse-engineered from
  today's snapshot Compare Ratio Total identity
  ``hud_national_dq_rate = current_afn_dq_rate / (current_compare_ratio / 100)``.
  Held constant across scenarios and horizons.
* **Projected Compare Ratio = afn_projected_dq_rate / hud_national_dq_rate * 100**
  — same formula HUD uses today, just with a projected AFN numerator.

Output shape
------------

.. code-block:: json

    {
      "projections": {
        "generated_at": "...",
        "generated_by": "scripts/build_projections.py v1",
        "horizons": [1, 3, 6],
        "scenarios": ["best", "base", "worst"],
        "performance_period": "YYYY-MM-DD",
        "assumptions": { ... },
        "national": { "1mo": { "base": {...}, "best": {...}, "worst": {...} }, ... },
        "hocs": { "Atlanta": { ... } , ... },
        "offices": [ { "office_id", "office_name", "hoc", ... "horizons": {...} } ],
        "loans": [ { "loan_id", "office_id", "hoc", ... per-loan fields ... } ]
      }
    }

CLI usage
---------

::

    python3 scripts/build_projections.py <period>

Reads ``public/data/snapshots/<period>.json``, augments it in place with a
``projections`` block, and writes the file back. Idempotent — rerunning
replaces the block cleanly. Use this when you want to add projections to
an already-published snapshot without re-parsing all six Excel files.

The primary integration point is ``build-snapshot.py``: it imports
:func:`build_projections` and calls it inline before the AI-insight step so
projected numbers flow into the LLM prompt.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = REPO_ROOT / "public" / "data" / "snapshots"

SCRIPT_VERSION = "1.0"
HORIZONS: Tuple[int, ...] = (1, 3, 6)
SCENARIOS: Tuple[str, ...] = ("best", "base", "worst")
HUD_WINDOW_MONTHS = 24
STRESS_PCT = 0.10  # ±10% delinquency lever
# Compare Ratio thresholds (mirrors the UI's threshold treatment).
THRESHOLD_WATCH = 150
THRESHOLD_BREACH = 200


# ─────────────────────────────────────────────────────────────────────────────
# Date helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_iso_date(s: Optional[str]) -> Optional[dt.date]:
    if not s or not isinstance(s, str):
        return None
    try:
        return dt.date.fromisoformat(s[:10])
    except (ValueError, TypeError):
        return None


def _shift_months(d: dt.date, months: int) -> dt.date:
    """Return d shifted by `months` months, clamped to the target month's
    last day when the source day-of-month doesn't exist (e.g. Feb 30 → Feb 28).
    """
    total = d.year * 12 + (d.month - 1) + months
    year, month0 = divmod(total, 12)
    month = month0 + 1
    # Clamp day to last day of month
    if month == 12:
        next_first = dt.date(year + 1, 1, 1)
    else:
        next_first = dt.date(year, month + 1, 1)
    last_day = (next_first - dt.timedelta(days=1)).day
    return dt.date(year, month, min(d.day, last_day))


def _rollforward_window_start(performance_period: dt.date, horizon_months: int) -> dt.date:
    """Return the window-start cutoff at horizon H months out.

    Matches ``rollforwardWindowStart`` in src/lib/computeData.ts (which uses
    (periodEnd + 1 day) - 21 months for H=3). Generalized: subtract
    (24 - H) months from (periodEnd + 1 day).
    """
    after = performance_period + dt.timedelta(days=1)
    return _shift_months(after, -(HUD_WINDOW_MONTHS - horizon_months))


# ─────────────────────────────────────────────────────────────────────────────
# Core projection math
# ─────────────────────────────────────────────────────────────────────────────

def _project_scenario_counts(
    in_window_total: int,
    in_window_delinquent: int,
    scenario: str,
) -> Tuple[int, int]:
    """Return (numerator, denominator) at horizon under `scenario`.

    Denominator is always the # of loans still in the rolled-forward window.
    Numerator is scenario-dependent (±10% lever).
    """
    in_window_non_delinquent = max(0, in_window_total - in_window_delinquent)
    if scenario == "base":
        num = in_window_delinquent
    elif scenario == "worst":
        # +10% of currently-non-delinquent, still-in-window loans become
        # delinquent. Round to nearest whole loan; never exceed denominator.
        shock = int(round(STRESS_PCT * in_window_non_delinquent))
        num = min(in_window_total, in_window_delinquent + shock)
    elif scenario == "best":
        # −10% of currently-delinquent, still-in-window loans cure.
        cure = int(round(STRESS_PCT * in_window_delinquent))
        num = max(0, in_window_delinquent - cure)
    else:
        raise ValueError(f"Unknown scenario: {scenario!r}")
    return num, in_window_total


def _classify_threshold(compare_ratio: Optional[float]) -> str:
    """Return 'safe' / 'watch' / 'breach' from a compare ratio."""
    if compare_ratio is None:
        return "unknown"
    if compare_ratio >= THRESHOLD_BREACH:
        return "breach"
    if compare_ratio >= THRESHOLD_WATCH:
        return "watch"
    return "safe"


def _compare_ratio(num: int, den: int, national_rate: Optional[float]) -> Optional[float]:
    """Return the office's compare ratio given raw counts + the national dq rate.

    ``national_rate`` is a fraction (e.g. 0.0532 for 5.32%). Returns None when
    either denominator is zero or national_rate is unavailable — matches the
    current UI's null-safety.
    """
    if den <= 0 or not national_rate or national_rate <= 0:
        return None
    office_rate = num / den
    return round((office_rate / national_rate) * 100, 1)


# ─────────────────────────────────────────────────────────────────────────────
# Loan-level projection
# ─────────────────────────────────────────────────────────────────────────────

def _project_loan(
    loan: Dict[str, Any],
    performance_period: dt.date,
) -> Dict[str, Any]:
    """Return per-loan projection fields (dates, drop-off booleans, etc.).

    Scenario-dependent per-loan delinquency status is NOT computed here —
    the ±10% lever is applied at aggregation time (it's an office-level
    stress, not a per-loan flip we could deterministically pick without
    additional loan-level risk scoring). What we CAN deterministically
    compute per-loan is:
      * first_payment_due_date (echo of source field)
      * months_until_falls_off (relative to a 24-mo window ending at
        `performance_period`)
      * will_fall_off_by_horizon per H (deterministic)
      * current_delinquency_status
    """
    fpd = _parse_iso_date(loan.get("first_payment_date"))
    is_delinquent = bool(loan.get("is_delinquent"))

    # Current window start = (performance_period + 1 day) - 24 months.
    current_window_start = _rollforward_window_start(performance_period, 0)

    months_until_falls_off: Optional[int] = None
    if fpd:
        # A loan "falls off" when the rolled-forward window-start passes its FPD.
        # For horizon H, cutoff_H = current_window_start + H months.
        # We want the smallest H such that cutoff_H > fpd, i.e.
        #   (current_window_start shifted by H months) > fpd.
        # Approx via month arithmetic; exact enough for compliance reporting.
        anchor = current_window_start
        # months from anchor to fpd+1day
        target = fpd + dt.timedelta(days=1)
        months_delta = (target.year - anchor.year) * 12 + (target.month - anchor.month)
        # target < anchor+H*mo iff months_delta < H (day-of-month refinement).
        if months_delta <= 0:
            months_until_falls_off = 0  # already outside the window (edge case)
        else:
            # Refine: if shifting anchor by months_delta lands on or after
            # target, then months_delta is our H; else H = months_delta + 1.
            candidate = _shift_months(anchor, months_delta)
            months_until_falls_off = months_delta if candidate > fpd else months_delta + 1

    will_fall_off: Dict[str, bool] = {}
    for h in HORIZONS:
        cutoff = _rollforward_window_start(performance_period, h)
        # Loans without a parseable FPD are assumed in-window.
        will_fall_off[f"{h}mo"] = bool(fpd and fpd < cutoff)

    return {
        "loan_id": loan.get("loan_id"),
        "fha_case_number": loan.get("fha_case_number"),
        "office_id": loan.get("hud_office"),
        "office_name": loan.get("hud_office"),
        "hoc": loan.get("hoc"),
        "channel": loan.get("channel"),
        "first_payment_due_date": loan.get("first_payment_date"),
        "months_until_falls_off": months_until_falls_off,
        "current_delinquency_status": {
            "is_delinquent": is_delinquent,
            "is_seriously_delinquent": bool(loan.get("is_seriously_delinquent")),
            "months_delinquent": loan.get("months_delinquent"),
            "delinquent_status": loan.get("delinquent_status"),
        },
        "will_fall_off_by_horizon": will_fall_off,
        # Deterministic per-loan projection under base scenario: loan is
        # counted delinquent at horizon H iff it stays in-window AND is
        # currently delinquent. Best/worst diverge only at the office level
        # via the ±10% office-wide lever (Michael's spec), so we don't
        # duplicate that here.
        "projected_in_window_by_horizon": {
            f"{h}mo": not will_fall_off[f"{h}mo"] for h in HORIZONS
        },
        "projected_delinquent_at_horizon_base": {
            f"{h}mo": is_delinquent and not will_fall_off[f"{h}mo"] for h in HORIZONS
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Aggregation
# ─────────────────────────────────────────────────────────────────────────────

def _aggregate_at_horizon(
    loans_view: List[Dict[str, Any]],
    horizon: int,
) -> Tuple[int, int]:
    """Return (in_window_total, in_window_delinquent) for a horizon over a
    list of *per-loan projection records* (as emitted by ``_project_loan``)."""
    total = 0
    dq = 0
    key = f"{horizon}mo"
    for l in loans_view:
        if l["projected_in_window_by_horizon"][key]:
            total += 1
            if l["current_delinquency_status"]["is_delinquent"]:
                dq += 1
    return total, dq


def _build_office_horizon_block(
    office_loans: List[Dict[str, Any]],
    horizon: int,
    national_rates: Dict[str, float],  # per-scenario national dq rate
) -> Dict[str, Any]:
    in_window_total, in_window_dq = _aggregate_at_horizon(office_loans, horizon)
    # Current-state comparison
    current_total = len(office_loans)
    current_dq = sum(
        1 for l in office_loans if l["current_delinquency_status"]["is_delinquent"]
    )
    dropoffs = current_total - in_window_total

    scenarios_block: Dict[str, Any] = {}
    for sc in SCENARIOS:
        num, den = _project_scenario_counts(in_window_total, in_window_dq, sc)
        cr = _compare_ratio(num, den, national_rates.get(sc))
        scenarios_block[sc] = {
            "projected_numerator": num,
            "projected_denominator": den,
            "projected_delinquency_rate": (
                round(num / den * 100, 4) if den > 0 else None
            ),
            "projected_compare_ratio": cr,
            "projected_threshold_status": _classify_threshold(cr),
        }

    return {
        "current_loans_in_window": current_total,
        "current_delinquent": current_dq,
        "projected_dropoffs": dropoffs,
        "projected_loans_in_window": in_window_total,
        "projected_delinquent_base": in_window_dq,
        "scenarios": scenarios_block,
    }


def _build_grouped_block(
    grouped_loans: Dict[str, List[Dict[str, Any]]],
    national_rates_by_horizon: Dict[int, Dict[str, float]],
) -> Dict[str, Dict[str, Any]]:
    """Given a dict of {key -> [loan_projection, ...]}, emit
    {key -> {"1mo": {...}, "3mo": {...}, "6mo": {...}}} shape."""
    out: Dict[str, Dict[str, Any]] = {}
    for key, loans_view in grouped_loans.items():
        per_horizon = {}
        for h in HORIZONS:
            per_horizon[f"{h}mo"] = _build_office_horizon_block(
                loans_view, h, national_rates_by_horizon[h]
            )
        out[key] = per_horizon
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def _hud_national_dq_rate(snapshot: Dict[str, Any]) -> Optional[float]:
    """Reverse-engineer HUD's national delinquency rate from the snapshot's
    Total Compare Ratio identity:

        current_compare_ratio = (afn_dq_rate / hud_national_dq_rate) * 100

    So ``hud_national_dq_rate = afn_dq_rate / (compare_ratio / 100)``.

    Returns a fraction (e.g. 0.0341 for 3.41%) or None if the snapshot lacks
    the fields needed to compute it. HUD does not publish their national
    reference directly in the monthly AFN snapshot; this identity is the
    contractual reverse-lookup.
    """
    for r in snapshot.get("compare_ratios_total") or []:
        if r.get("scope") != "total":
            continue
        loans = r.get("loans_count") or 0
        dq = r.get("delinquent_count") or 0
        cr = r.get("compare_ratio")
        if loans <= 0 or dq <= 0 or not cr or cr <= 0:
            return None
        afn_rate = dq / loans
        return afn_rate / (cr / 100.0)
    return None


def build_projections(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """Compute the ``projections`` block for `snapshot`.

    Reads ``snapshot['loans']`` and ``snapshot['snapshot_meta'].performance_period``
    and returns the full projections dict. Does not mutate `snapshot`.
    """
    meta = snapshot.get("snapshot_meta") or {}
    perf = _parse_iso_date(meta.get("performance_period"))
    if not perf:
        raise ValueError(
            "snapshot_meta.performance_period is required (ISO date) to build projections"
        )

    loans_source = snapshot.get("loans") or []
    # 1) Per-loan projections
    loan_projections = [_project_loan(l, perf) for l in loans_source]

    # 2) Current CR from snapshot (per-office; used as baseline)
    current_office_cr: Dict[str, Optional[float]] = {}
    for o in snapshot.get("compare_ratios_hud_office") or []:
        current_office_cr[o.get("hud_office")] = o.get("compare_ratio")
    current_hoc_cr: Dict[str, Optional[float]] = {}
    for h in snapshot.get("compare_ratios_hoc") or []:
        current_hoc_cr[h.get("hoc_name")] = h.get("compare_ratio")
    current_total_cr: Optional[float] = None
    for r in snapshot.get("compare_ratios_total") or []:
        if r.get("scope") == "total":
            current_total_cr = r.get("compare_ratio")
            break

    # 2b) Peer benchmark — HUD's national delinquency rate, reverse-engineered
    #     from the snapshot's Compare Ratio Total identity. Held constant
    #     across scenarios and horizons (HUD doesn't roll their reference in
    #     AFN's monthly snapshot). Used as the denominator for national and
    #     HOC-scope Compare Ratios so those numbers are directly comparable
    #     to today's headline (~156 for May 2026) instead of collapsing to 100.
    hud_national_rate = _hud_national_dq_rate(snapshot)

    # 3) National aggregation — anchored to HUD's national reference so the
    #    projected national Compare Ratio is directly comparable to today's
    #    headline number. The ±10% lever moves the AFN numerator; the HUD
    #    denominator is held constant across scenarios/horizons.
    #
    #    Every scope (office, HOC, national) uses the same HUD-anchored
    #    rate table as its Compare Ratio denominator. This makes office
    #    projected CRs directly comparable to today's HUD Office Compare
    #    Ratios on the headline dashboard.
    scope_national_rates_by_horizon: Dict[int, Dict[str, float]] = {
        h: {sc: (hud_national_rate or 0.0) for sc in SCENARIOS} for h in HORIZONS
    }
    national_blocks: Dict[str, Any] = {}
    for h in HORIZONS:
        in_win_total, in_win_dq = _aggregate_at_horizon(loan_projections, h)
        scenarios_block: Dict[str, Any] = {}
        for sc in SCENARIOS:
            num, den = _project_scenario_counts(in_win_total, in_win_dq, sc)
            rate = (num / den) if den > 0 else 0.0
            # National Compare Ratio at scenario S = AFN portfolio dq rate
            # under S divided by HUD's national reference dq rate. Under base
            # this reproduces (approximately) today's headline Compare Ratio;
            # under best/worst the ±10% lever produces a genuine spread.
            if hud_national_rate and hud_national_rate > 0 and den > 0:
                cr = round((rate / hud_national_rate) * 100, 1)
            else:
                cr = None
            scenarios_block[sc] = {
                "projected_numerator": num,
                "projected_denominator": den,
                "projected_delinquency_rate": round(rate * 100, 4) if den > 0 else None,
                "projected_compare_ratio": cr,
                "projected_threshold_status": _classify_threshold(cr),
            }
        national_blocks[f"{h}mo"] = {
            "current_loans_in_window": len(loan_projections),
            "current_delinquent": sum(
                1 for l in loan_projections if l["current_delinquency_status"]["is_delinquent"]
            ),
            "projected_dropoffs": len(loan_projections) - in_win_total,
            "projected_loans_in_window": in_win_total,
            "projected_delinquent_base": in_win_dq,
            "scenarios": scenarios_block,
        }

    # 4) Group per-loan by office and by HOC
    by_office: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    by_hoc: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for lp in loan_projections:
        office = lp.get("office_id")
        if office:
            by_office[office].append(lp)
        hoc = lp.get("hoc")
        if hoc:
            by_hoc[hoc].append(lp)

    # HOC blocks use the HUD anchor (same as national + office). The ±10%
    # lever is applied to the HOC's AFN projected numerator, and the
    # denominator is HUD's constant national reference rate. This gives HOC
    # CR the same semantics as the headline Compare Ratio Total (directly
    # comparable to today's per-HOC CRs).
    hoc_block = _build_grouped_block(dict(by_hoc), scope_national_rates_by_horizon)
    # Attach current CR to HOCs
    hoc_out: Dict[str, Any] = {}
    for name, per_h in hoc_block.items():
        hoc_out[name] = {
            "hoc_name": name,
            "current_compare_ratio": current_hoc_cr.get(name),
            "current_threshold_status": _classify_threshold(current_hoc_cr.get(name)),
            "horizons": per_h,
        }

    # 5) Offices — array with rich per-office context
    office_records: List[Dict[str, Any]] = []
    for office_name, office_loans_view in by_office.items():
        per_h = {}
        for h in HORIZONS:
            per_h[f"{h}mo"] = _build_office_horizon_block(
                office_loans_view, h, scope_national_rates_by_horizon[h]
            )
        # HOC lookup: any loan in the office knows its HOC.
        hoc_name = next(
            (l.get("hoc") for l in office_loans_view if l.get("hoc")), None
        )
        current_cr = current_office_cr.get(office_name)
        record = OrderedDict()
        record["office_id"] = office_name  # HUD office name IS the identifier
        record["office_name"] = office_name
        record["hoc"] = hoc_name
        record["loan_count_current"] = len(office_loans_view)
        record["delinquent_count_current"] = sum(
            1 for l in office_loans_view if l["current_delinquency_status"]["is_delinquent"]
        )
        record["current_compare_ratio"] = current_cr
        record["current_threshold_status"] = _classify_threshold(current_cr)
        record["horizons"] = per_h
        # Convenience: which horizons/scenarios cross a threshold this office
        # doesn't currently breach? Downstream (AI, report) can use this.
        crosses: List[Dict[str, Any]] = []
        current_status = _classify_threshold(current_cr)
        for h in HORIZONS:
            for sc in SCENARIOS:
                proj_cr = per_h[f"{h}mo"]["scenarios"][sc]["projected_compare_ratio"]
                proj_status = per_h[f"{h}mo"]["scenarios"][sc]["projected_threshold_status"]
                # Escalation: current safe → watch/breach, or current watch → breach.
                if current_status == "safe" and proj_status in ("watch", "breach"):
                    crosses.append({
                        "horizon_months": h,
                        "scenario": sc,
                        "from_status": current_status,
                        "to_status": proj_status,
                        "current_compare_ratio": current_cr,
                        "projected_compare_ratio": proj_cr,
                    })
                elif current_status == "watch" and proj_status == "breach":
                    crosses.append({
                        "horizon_months": h,
                        "scenario": sc,
                        "from_status": current_status,
                        "to_status": proj_status,
                        "current_compare_ratio": current_cr,
                        "projected_compare_ratio": proj_cr,
                    })
        record["threshold_crossings"] = crosses
        office_records.append(record)

    # Sort offices deterministically — by projected 3mo/base CR desc so the
    # most-worrying offices float to the top (with None sinking to the bottom).
    def _sort_key(r: Dict[str, Any]) -> Tuple[int, float]:
        cr = r["horizons"]["3mo"]["scenarios"]["base"]["projected_compare_ratio"]
        # Push None to the bottom, else sort descending
        if cr is None:
            return (1, 0.0)
        return (0, -float(cr))

    office_records.sort(key=_sort_key)

    # 6) Assemble
    projections = OrderedDict()
    projections["generated_at"] = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    projections["generated_by"] = f"scripts/build_projections.py v{SCRIPT_VERSION}"
    projections["performance_period"] = perf.isoformat()
    projections["horizons"] = list(HORIZONS)
    projections["scenarios"] = list(SCENARIOS)
    projections["assumptions"] = {
        "hud_window_months": HUD_WINDOW_MONTHS,
        "scenario_stress_pct": STRESS_PCT,
        "scenario_semantics": {
            "base": "no delinquency change; only 24-mo window rolls forward",
            "worst": (
                f"+{int(STRESS_PCT*100)}% of currently-non-delinquent, still-in-window loans "
                "become delinquent at horizon (AFN numerator stress applied at every scope; "
                "HUD national reference held constant)"
            ),
            "best": (
                f"-{int(STRESS_PCT*100)}% of currently-delinquent, still-in-window loans "
                "cure at horizon (AFN numerator stress applied at every scope; HUD national "
                "reference held constant)"
            ),
        },
        "national_reference_policy": (
            "Compare Ratio denominators at every scope (office / HOC / national) use HUD's "
            "national delinquency rate as the peer benchmark, reverse-engineered from today's "
            "Compare Ratio Total identity (afn_dq_rate / (current_compare_ratio / 100)). This "
            "HUD anchor is held constant across scenarios, horizons, and offices — HUD does "
            "not roll their reference in AFN's monthly snapshot. The ±10% lever moves the AFN "
            "numerator at every scope. Office projected CRs are directly comparable to the "
            "HUD Office Compare Ratios shown in the headline dashboard."
        ),
        "hud_national_dq_rate": (
            round(hud_national_rate, 6) if hud_national_rate is not None else None
        ),
        "hud_national_dq_rate_pct": (
            round(hud_national_rate * 100, 4) if hud_national_rate is not None else None
        ),
        "hud_national_dq_rate_source": (
            "reverse-engineered from compare_ratios_total[scope=total].compare_ratio and "
            "delinquent_count/loans_count"
        ),
        "threshold_watch": THRESHOLD_WATCH,
        "threshold_breach": THRESHOLD_BREACH,
        "compare_ratio_formula": (
            "afn_projected_delinquency_rate / hud_national_dq_rate * 100 "
            "(applies uniformly at office / HOC / national scope; HUD anchor is a single "
            "constant across scenarios, horizons, and offices)"
        ),
        "missing_first_payment_date_policy": (
            "loans without a parseable first_payment_date are assumed to stay in-window "
            "(conservative — never shrinks the denominator on missing data)"
        ),
    }
    projections["current_compare_ratio_total"] = current_total_cr
    projections["national"] = national_blocks
    projections["hocs"] = hoc_out
    projections["offices"] = office_records
    projections["loans"] = loan_projections
    return projections


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="Augment a snapshot JSON with the projections block")
    ap.add_argument("period", help="YYYY-MM period, e.g. 2026-05")
    ap.add_argument("--in", dest="in_path", default=None,
                    help="Input snapshot JSON (default: public/data/snapshots/<period>.json)")
    ap.add_argument("--out", dest="out_path", default=None,
                    help="Output path (default: overwrite input)")
    args = ap.parse_args()

    in_path = Path(args.in_path) if args.in_path else SNAPSHOT_DIR / f"{args.period}.json"
    if not in_path.exists():
        print(f"ERROR: {in_path} does not exist", file=sys.stderr)
        return 2

    with open(in_path, encoding="utf-8") as f:
        snapshot = json.load(f)

    print(f"Building projections for {args.period} ({in_path.name})…")
    projections = build_projections(snapshot)
    n_offices = len(projections["offices"])
    n_loans = len(projections["loans"])
    n_crossings = sum(len(o["threshold_crossings"]) for o in projections["offices"])
    print(f"  {n_offices} offices, {n_loans:,} loans, {n_crossings} threshold-crossing events")

    snapshot["projections"] = projections

    out_path = Path(args.out_path) if args.out_path else in_path
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, default=str)
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f"Wrote {out_path} ({size_mb:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
