#!/usr/bin/env python3
"""
Generate the Projections validation report for Stefanie Allman.

Produces a standalone Markdown report at
``reports/projections-validation-<snapshot-date>.md``. The companion PDF is
rendered separately via ``pandoc`` (see the ``--pdf`` flag) so the auditor
gets both an editable source and a print-ready artifact.

Contents:

* **Executive summary** — offices projected to be in breach/watch under
  base 3mo, plus offices genuinely crossing a threshold under worst.
* **Per-office table** — every office, all 3 horizons \u00d7 3 scenarios,
  loan count, projected drop-offs, threshold status.
* **Methodology appendix** — the loan-level math, scenario semantics,
  aggregation rules, and rounding conventions. Stefanie should be able
  to reproduce the numbers by hand for any sample office.
* **Sample loan-level detail** — every underlying loan for the top 3
  flagged offices, so spot-checks against Encompass are straightforward.

Usage
-----

::

    python3 scripts/build_projections_report.py <period> [--pdf]

Reads the snapshot from ``public/data/snapshots/<period>.json``; requires
the ``projections`` block to have been computed. If the snapshot lacks
projections, the script computes them in memory (does not write back).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = REPO_ROOT / "public" / "data" / "snapshots"
REPORTS_DIR = REPO_ROOT / "reports"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_projections import build_projections  # noqa: E402


def _fmt_num(v: Any, digits: int = 1) -> str:
    """Format numeric-or-None safely — returns `—` when missing."""
    if v is None:
        return "—"
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    if digits == 0:
        return f"{int(round(f))}"
    return f"{f:.{digits}f}"


def _fmt_int(v: Any) -> str:
    if v is None:
        return "—"
    try:
        return f"{int(v):,}"
    except (TypeError, ValueError):
        return str(v)


def _fmt_status(s: Optional[str]) -> str:
    return (s or "unknown").upper()


def _executive_summary(projections: Dict[str, Any]) -> List[str]:
    lines: List[str] = ["## Executive Summary", ""]
    offices = projections.get("offices") or []
    total = len(offices)

    # Cohort counts
    current_cohort = {"safe": 0, "watch": 0, "breach": 0, "unknown": 0}
    proj_3mo_base_cohort = {"safe": 0, "watch": 0, "breach": 0, "unknown": 0}
    proj_3mo_worst_cohort = {"safe": 0, "watch": 0, "breach": 0, "unknown": 0}
    for o in offices:
        current_cohort[o["current_threshold_status"]] += 1
        proj_3mo_base_cohort[
            o["horizons"]["3mo"]["scenarios"]["base"]["projected_threshold_status"]
        ] += 1
        proj_3mo_worst_cohort[
            o["horizons"]["3mo"]["scenarios"]["worst"]["projected_threshold_status"]
        ] += 1

    lines.append(f"* **Total offices evaluated:** {total}")
    lines.append(
        f"* **Current threshold cohort:** "
        f"{current_cohort['safe']} safe / {current_cohort['watch']} watch / {current_cohort['breach']} breach"
    )
    lines.append(
        f"* **Projected 3mo (base) cohort:** "
        f"{proj_3mo_base_cohort['safe']} safe / {proj_3mo_base_cohort['watch']} watch / {proj_3mo_base_cohort['breach']} breach"
    )
    lines.append(
        f"* **Projected 3mo (worst) cohort:** "
        f"{proj_3mo_worst_cohort['safe']} safe / {proj_3mo_worst_cohort['watch']} watch / {proj_3mo_worst_cohort['breach']} breach"
    )
    nat = projections["national"]["3mo"]
    lines.append(
        f"* **National 3mo base:** "
        f"{nat['scenarios']['base']['projected_delinquency_rate']}% dq rate "
        f"on {_fmt_int(nat['projected_loans_in_window'])} loans "
        f"(dropoffs: {_fmt_int(nat['projected_dropoffs'])})"
    )
    lines.append("")

    # Top 5 by 3mo base CR that are in watch/breach
    top_base = sorted(
        [
            o for o in offices
            if o["horizons"]["3mo"]["scenarios"]["base"]["projected_threshold_status"]
            in ("watch", "breach")
        ],
        key=lambda o: -(
            o["horizons"]["3mo"]["scenarios"]["base"]["projected_compare_ratio"] or 0
        ),
    )[:5]

    lines.append(
        "### Top 5 offices in projected watch/breach at 3-month base scenario"
    )
    lines.append("")
    if not top_base:
        lines.append(
            "_No offices project into watch or breach under the 3-month base "
            "scenario. This is expected when window roll-off is faster than "
            "delinquency accumulation._"
        )
        lines.append("")
    else:
        lines.append(
            "| # | Office | HOC | Loans | Current CR | Projected 3mo CR (base) | Projected Status |"
        )
        lines.append("|---|--------|-----|-------|-----------|------------------------|------------------|")
        for i, o in enumerate(top_base, start=1):
            b = o["horizons"]["3mo"]["scenarios"]["base"]
            lines.append(
                f"| {i} | **{o['office_name']}** | {o['hoc'] or '—'} | "
                f"{_fmt_int(o['loan_count_current'])} | {_fmt_num(o['current_compare_ratio'], 0)} | "
                f"{_fmt_num(b['projected_compare_ratio'], 1)} | {_fmt_status(b['projected_threshold_status'])} |"
            )
        lines.append("")

    # Top threshold-crossings (any horizon/scenario), safe → breach first
    all_crossings: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for o in offices:
        for c in o.get("threshold_crossings") or []:
            all_crossings.append((o, c))
    priority_map = {
        ("safe", "breach"): 0,
        ("safe", "watch"): 1,
        ("watch", "breach"): 2,
    }
    all_crossings.sort(
        key=lambda oc: (
            priority_map.get((oc[1]["from_status"], oc[1]["to_status"]), 9),
            -(oc[1]["projected_compare_ratio"] or 0),
        )
    )
    lines.append(
        "### Threshold crossings — offices that escalate under any horizon/scenario"
    )
    lines.append("")
    lines.append(
        f"_{len(all_crossings)} crossing events total (across 1/3/6mo \u00d7 best/base/worst)._ "
        "Highest-priority (safe\u2192breach) shown first, capped at 15 rows."
    )
    lines.append("")
    if not all_crossings:
        lines.append("_None._")
        lines.append("")
    else:
        lines.append(
            "| Office | HOC | Loans | Horizon | Scenario | Current CR | Projected CR | Transition |"
        )
        lines.append("|--------|-----|-------|---------|----------|-----------|-------------|-----------|")
        for o, c in all_crossings[:15]:
            lines.append(
                f"| **{o['office_name']}** | {o['hoc'] or '—'} | "
                f"{_fmt_int(o['loan_count_current'])} | {c['horizon_months']}mo | "
                f"{c['scenario']} | {_fmt_num(c['current_compare_ratio'], 0)} | "
                f"{_fmt_num(c['projected_compare_ratio'], 1)} | "
                f"{c['from_status'].upper()} → {c['to_status'].upper()} |"
            )
        lines.append("")

    return lines


def _per_office_table(projections: Dict[str, Any]) -> List[str]:
    lines: List[str] = ["## Per-Office Projected Compare Ratios", ""]
    lines.append(
        "Every HUD office in the current window, sorted by projected 3mo/base CR (highest first). "
        "Columns:"
    )
    lines.append("")
    lines.append(
        "* **Cur** — Compare Ratio as of the snapshot's performance period.\n"
        "* **1mo / 3mo / 6mo** — projected Compare Ratio at that horizon.\n"
        "  Each cell shows `best / base / worst`.\n"
        "* **N** — loan count in the current 24-month window.\n"
        "* **Drop 3mo** — loans projected to fall off the office denominator by month 3.\n"
        "* **Status** — current → projected 3mo/base threshold status."
    )
    lines.append("")

    header = (
        "| Office | HOC | N | Cur | "
        "1mo (best/base/worst) | 3mo (best/base/worst) | 6mo (best/base/worst) | "
        "Drop 3mo | Status |"
    )
    lines.append(header)
    lines.append(
        "|--------|-----|---|-----|"
        "-----------------------|-----------------------|-----------------------|"
        "----------|--------|"
    )

    def _cell(h_block: Dict[str, Any]) -> str:
        scen = h_block["scenarios"]
        return (
            f"{_fmt_num(scen['best']['projected_compare_ratio'], 1)} / "
            f"{_fmt_num(scen['base']['projected_compare_ratio'], 1)} / "
            f"{_fmt_num(scen['worst']['projected_compare_ratio'], 1)}"
        )

    for o in projections.get("offices") or []:
        h = o["horizons"]
        current_status = o["current_threshold_status"]
        base3 = h["3mo"]["scenarios"]["base"]["projected_threshold_status"]
        lines.append(
            f"| {o['office_name']} | {o['hoc'] or '—'} | "
            f"{_fmt_int(o['loan_count_current'])} | "
            f"{_fmt_num(o['current_compare_ratio'], 0)} | "
            f"{_cell(h['1mo'])} | {_cell(h['3mo'])} | {_cell(h['6mo'])} | "
            f"{_fmt_int(h['3mo']['projected_dropoffs'])} | "
            f"{current_status.upper()} → {base3.upper()} |"
        )
    lines.append("")
    return lines


def _methodology(projections: Dict[str, Any]) -> List[str]:
    a = projections["assumptions"]
    lines = [
        "## Methodology Appendix",
        "",
        (
            "Every number in this report is computed at the individual loan level, then "
            "aggregated up to office, HOC, and national roll-ups. There are no "
            "office-level estimates that a hand-check against Encompass could not "
            "reproduce."
        ),
        "",
        "### 1. HUD 24-month window",
        "",
        (
            "HUD reports each month with a rolling 24-month window of \"beginning "
            "amortization dates\" (first-payment dates) ending at "
            f"`performance_period` = **{projections['performance_period']}**."
        ),
        "",
        (
            "For a projection **H** months forward, the new window-start is:"
        ),
        "",
        "```",
        "cutoff_H = (performance_period + 1 day) - (24 - H) months",
        "```",
        "",
        (
            "A loan is projected to fall off the denominator at horizon H iff its "
            "`first_payment_date` is strictly less than `cutoff_H`. Loans without a "
            "parseable `first_payment_date` are assumed to remain in-window — this "
            "matches the current UI (`rollforwardWindowStart` in "
            "`src/lib/computeData.ts`) and is deliberately conservative: missing data "
            "never shrinks a denominator."
        ),
        "",
        "### 2. Scenarios — ±10% office-side delinquency lever",
        "",
        (
            f"The stress factor is **{int(a['scenario_stress_pct']*100)}%** (Michael Kunisaki's decision, "
            "task-spec §Michael's Decisions #3). It is an **office-side stress**: national "
            "delinquency rate stays at the base-scenario projection at each horizon and "
            "serves as the fixed reference denominator for the Compare Ratio."
        ),
        "",
        "| Scenario | Office numerator | Denominator | Semantics |",
        "|----------|------------------|-------------|-----------|",
        "| `base`  | Loans in-window that are currently delinquent | Loans still in-window at horizon | No delinquency change; only window rolls forward. |",
        f"| `worst` | base numerator + round(0.10 × in-window non-DQ) | Same as base | +{int(a['scenario_stress_pct']*100)}% of the office's still-in-window, currently-non-DQ loans become DQ. |",
        f"| `best`  | base numerator − round(0.10 × in-window DQ), floored at 0 | Same as base | −{int(a['scenario_stress_pct']*100)}% of the office's currently-DQ, still-in-window loans cure. |",
        "",
        (
            "**National reference policy:** " + a.get("national_reference_policy", "")
        ),
        "",
        "### 3. Compare Ratio formula",
        "",
        "```",
        "office_projected_delinquency_rate    = office_num_at_horizon / office_den_at_horizon",
        "national_projected_delinquency_rate  = national_base_num_at_horizon / national_base_den_at_horizon",
        "projected_compare_ratio              = (office_dq_rate / national_dq_rate) * 100",
        "```",
        "",
        (
            "Numerator and denominator both use the same rolled-forward loan population — no "
            "mismatched windows. Ratios are rounded to one decimal place at the report "
            "boundary; internal math stays in double precision."
        ),
        "",
        "### 4. Threshold classification",
        "",
        f"* `safe`   → CR < {a['threshold_watch']}",
        f"* `watch`  → {a['threshold_watch']} ≤ CR < {a['threshold_breach']}",
        f"* `breach` → CR ≥ {a['threshold_breach']}",
        "",
        (
            "A **threshold crossing** is any transition where the current status is "
            "strictly less severe than the projected status under some horizon/scenario. "
            "Specifically: safe→watch, safe→breach, or watch→breach. Watch→watch or "
            "breach→breach at a lower projected CR are still worth noting but are "
            "reported in the Per-Office table rather than the crossings summary."
        ),
        "",
        "### 5. Reproducibility recipe (hand-checkable, one office)",
        "",
        (
            "For any office in the Per-Office table, follow these steps against the "
            "Encompass source data used by `build-snapshot.py`:"
        ),
        "",
        "1. Filter loans to that HUD office.",
        "2. Split into (a) still-in-window at horizon H (first_payment_date ≥ cutoff_H) and (b) dropping off.",
        f"3. Under **base**: numerator = count of still-in-window loans where `is_delinquent = true`; denominator = |(a)|.",
        f"4. Under **worst**: numerator = base numerator + round(0.10 × |non-DQ in (a)|); denominator unchanged.",
        f"5. Under **best**: numerator = base numerator − round(0.10 × |DQ in (a)|), floored at 0.",
        "6. Compare Ratio = office_dq_rate / national_base_dq_rate × 100 (national values in the report tables).",
        "",
    ]
    return lines


def _sample_loan_detail(projections: Dict[str, Any], top_n: int = 3) -> List[str]:
    """Emit the full loan-level detail for the top-N flagged offices."""
    offices = projections.get("offices") or []
    # "Top flagged" = highest projected 3mo/base CR that is in watch or breach.
    # If none in watch/breach under base, fall back to top 3 by 3mo/worst CR.
    flagged = [
        o for o in offices
        if o["horizons"]["3mo"]["scenarios"]["base"]["projected_threshold_status"]
        in ("watch", "breach")
    ]
    if not flagged:
        flagged = list(offices)
    flagged.sort(
        key=lambda o: -(
            o["horizons"]["3mo"]["scenarios"]["base"]["projected_compare_ratio"] or 0
        )
    )
    flagged = flagged[:top_n]

    # Build loan_id → projection lookup for quick access
    loan_lookup: Dict[str, Dict[str, Any]] = {
        l["loan_id"]: l for l in projections.get("loans") or [] if l.get("loan_id")
    }
    # Group loans by office
    loans_by_office: Dict[str, List[Dict[str, Any]]] = {}
    for l in projections.get("loans") or []:
        oid = l.get("office_id")
        if oid:
            loans_by_office.setdefault(oid, []).append(l)

    lines = [
        "## Sample Loan-Level Detail — Top Flagged Offices",
        "",
        (
            "Every loan underlying the highest-projected offices, so a Compliance "
            "review can spot-check against Encompass. Loans are grouped by office "
            "and sorted by `months_until_falls_off` (ascending — loans closest to "
            "dropping off the window first)."
        ),
        "",
    ]
    for o in flagged:
        h3 = o["horizons"]["3mo"]
        lines.append(
            f"### {o['office_name']} (HOC {o['hoc'] or '—'})"
        )
        lines.append("")
        lines.append(
            f"* Current loans in window: **{_fmt_int(o['loan_count_current'])}** — "
            f"currently delinquent: {_fmt_int(o['delinquent_count_current'])}\n"
            f"* Current Compare Ratio: **{_fmt_num(o['current_compare_ratio'], 0)}**  "
            f"→ 3mo/base: **{_fmt_num(h3['scenarios']['base']['projected_compare_ratio'], 1)}**\n"
            f"* Projected drop-offs by 3mo: **{_fmt_int(h3['projected_dropoffs'])}** "
            f"({_fmt_int(h3['projected_loans_in_window'])} still in window)"
        )
        lines.append("")

        office_loans = loans_by_office.get(o["office_id"], [])
        # Sort by months_until_falls_off asc (None → end)
        office_loans_sorted = sorted(
            office_loans,
            key=lambda l: (
                l.get("months_until_falls_off") is None,
                l.get("months_until_falls_off") if l.get("months_until_falls_off") is not None else 999,
            ),
        )
        lines.append(
            "| Loan ID | FHA Case # | FPDD | Mo. until off-window | Currently DQ | "
            "Falls off 1mo | Falls off 3mo | Falls off 6mo | DQ status |"
        )
        lines.append(
            "|---------|-----------|------|---------------------|--------------|"
            "---------------|---------------|---------------|-----------|"
        )
        for l in office_loans_sorted:
            dq = l["current_delinquency_status"]
            fo = l["will_fall_off_by_horizon"]
            lines.append(
                f"| `{l['loan_id']}` | {l.get('fha_case_number') or '—'} | "
                f"{l.get('first_payment_due_date') or '—'} | "
                f"{_fmt_int(l.get('months_until_falls_off'))} | "
                f"{'✓' if dq['is_delinquent'] else '—'} | "
                f"{'✓' if fo['1mo'] else '—'} | "
                f"{'✓' if fo['3mo'] else '—'} | "
                f"{'✓' if fo['6mo'] else '—'} | "
                f"{dq.get('delinquent_status') or '—'} |"
            )
        lines.append("")

    return lines


def build_report_markdown(snapshot: Dict[str, Any]) -> str:
    proj = snapshot.get("projections") or build_projections(snapshot)
    meta = snapshot.get("snapshot_meta") or {}
    period = meta.get("period", "unknown")
    perf = proj.get("performance_period", meta.get("performance_period", "unknown"))
    label = meta.get("label") or perf
    generated_at = proj.get("generated_at") or (
        dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    )

    header = [
        f"# FHA Risk Monitor — Projections Validation Report",
        "",
        f"**Snapshot period:** {label} ({period})",
        f"**Performance-period end:** {perf}",
        f"**Report generated:** {generated_at}",
        f"**Prepared for:** Stefanie Allman, Compliance",
        f"**Requester:** Michael Kunisaki (mkunisaki@afncorp.com)",
        f"**Source:** `scripts/build_projections.py` v"
        + proj.get("generated_by", "").split("v")[-1].strip(),
        "",
        (
            "This report validates the loan-level → office → HOC → national "
            "projections shipped in the `projections` block of the monthly "
            "snapshot JSON. It is intended to be auditable end-to-end: every "
            "office-level number can be traced to the underlying loan set and "
            "reproduced by hand using the recipe in the Methodology appendix."
        ),
        "",
        "---",
        "",
    ]
    parts = [
        "\n".join(header),
        "\n".join(_executive_summary(proj)),
        "\n".join(_per_office_table(proj)),
        "\n".join(_methodology(proj)),
        "\n".join(_sample_loan_detail(proj)),
    ]
    return "\n".join(parts)


def render_pdf(md_path: Path, pdf_path: Path) -> bool:
    """Render the Markdown report to PDF via pandoc.

    Returns True on success, False on any failure (we log to stderr and let
    the caller decide whether to bail).
    """
    # Use `pdf-engine=weasyprint` (installed) — better CSS support than
    # the default LaTeX engine and no need to install a full TeX distro.
    cmd = [
        "pandoc",
        str(md_path),
        "-o",
        str(pdf_path),
        "--pdf-engine=weasyprint",
        "--metadata",
        "title=FHA Risk Monitor — Projections Validation Report",
        "-V",
        "geometry:margin=0.75in",
        "-V",
        "papersize=letter",
        "--toc",
        "--toc-depth=2",
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=240)
        return True
    except FileNotFoundError:
        print("  WARN: pandoc not installed — skipping PDF", file=sys.stderr)
        return False
    except subprocess.CalledProcessError as e:
        print(
            f"  WARN: pandoc failed (exit {e.returncode}); stderr:\n{e.stderr[:800]}",
            file=sys.stderr,
        )
        return False
    except subprocess.TimeoutExpired:
        print("  WARN: pandoc timed out (>240s)", file=sys.stderr)
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Build the projections validation report")
    ap.add_argument("period", help="YYYY-MM period, e.g. 2026-05")
    ap.add_argument(
        "--in",
        dest="in_path",
        default=None,
        help="Input snapshot JSON (default: public/data/snapshots/<period>.json)",
    )
    ap.add_argument(
        "--out-dir",
        default=str(REPORTS_DIR),
        help="Output directory (default: reports/)",
    )
    ap.add_argument(
        "--pdf",
        action="store_true",
        help="Also render a PDF via pandoc (uses --pdf-engine=weasyprint)",
    )
    args = ap.parse_args()

    in_path = Path(args.in_path) if args.in_path else SNAPSHOT_DIR / f"{args.period}.json"
    if not in_path.exists():
        print(f"ERROR: {in_path} does not exist", file=sys.stderr)
        return 2
    with open(in_path, encoding="utf-8") as f:
        snapshot = json.load(f)

    print(f"Building projections validation report for {args.period}…")
    md = build_report_markdown(snapshot)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    perf = (
        snapshot.get("projections", {}).get("performance_period")
        or snapshot.get("snapshot_meta", {}).get("performance_period")
        or args.period
    )
    stem = f"projections-validation-{perf}"
    md_path = out_dir / f"{stem}.md"
    md_path.write_text(md, encoding="utf-8")
    print(f"Wrote {md_path} ({md_path.stat().st_size / 1024:.1f} KB)")

    if args.pdf:
        pdf_path = out_dir / f"{stem}.pdf"
        if render_pdf(md_path, pdf_path):
            print(f"Wrote {pdf_path} ({pdf_path.stat().st_size / 1024:.1f} KB)")
        else:
            print("PDF rendering skipped or failed — Markdown was still written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
