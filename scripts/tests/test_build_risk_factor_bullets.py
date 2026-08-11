"""Unit tests for ``build_risk_factor_bullets`` in ``scripts/build-snapshot.py``.

These verify the provider selector, response parsing, and the "never fail
the snapshot build" contract.

Prompt file resolution:
    ``_load_risk_factor_prompt`` reads
    ``<REPO_ROOT>/data/prompts/risk-factor-analysis.system.md`` where
    ``REPO_ROOT = Path(__file__).resolve().parent.parent`` inside
    ``build-snapshot.py``. The real file ships with the repo, so tests
    exercise it as-is; the "missing prompt" test monkeypatches
    ``RISK_FACTOR_PROMPT_PATH`` to a non-existent path.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest


SCRIPTS_DIR = Path(__file__).resolve().parent.parent
BUILD_SCRIPT = SCRIPTS_DIR / "build-snapshot.py"


def _load_build_snapshot(source_root: Path):
    """Import ``scripts/build-snapshot.py`` as a module (fresh copy per test)."""
    os.environ["SNAPSHOT_SOURCE_ROOT"] = str(source_root)
    mod_name = "build_snapshot_under_test_rfb"
    sys.modules.pop(mod_name, None)
    spec = importlib.util.spec_from_file_location(mod_name, str(BUILD_SCRIPT))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


@pytest.fixture()
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear all AI-related env vars so each test drives the selector."""
    for key in (
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_DEPLOYMENT",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_API_VERSION",
        "AFN_LITELLM_API_KEY",
        "AFN_LITELLM_BASE_URL",
        "AFN_LITELLM_INSIGHT_MODEL",
    ):
        monkeypatch.delenv(key, raising=False)


def _minimal_snapshot() -> dict:
    """Snapshot skeleton with just enough shape for `_build_risk_factor_facts`.

    The facts builder reads ``loans``, ``compare_ratios_hud_office``, and
    ``compare_ratios_total`` \u2014 all defaulted with ``.get(...)`` \u2014 so this
    minimal document produces a valid facts string (with mostly zeros).
    """
    return {
        "snapshot_meta": {
            "label": "August 2026",
            "performance_period": "2026-08-31",
            "generated_at": "2026-08-11T21:00:00Z",
            "generated_by": "scripts/build-snapshot.py v1.0",
            "schema_version": 1,
        },
        "compare_ratios_total": [],
        "compare_ratios_hud_office": [],
        "portfolio_slices": [],
        "loans": [],
    }


def _canned_bullets_payload() -> str:
    """A valid `executiveSummary` payload the LLM would return."""
    return json.dumps(
        {
            "executiveSummary": [
                {
                    "text": "Manual UW drives 4.2% DQ vs 1.1% auto; layered risk offices at 3+ indicators show 8.7% DQ.",
                    "severity": "red",
                },
                {
                    "text": "Secured Borrowed source-of-funds bucket runs 9.7% DQ vs Borrower Funds 3.1% \u2014 material outlier.",
                    "severity": "red",
                },
                {
                    "text": "LTV 97+ segment DQ 5.4% vs <80% at 1.2%; concentration risk in high-LTV DPA-heavy offices.",
                    "severity": "yellow",
                },
                {
                    "text": "FTHB=Yes DQ 3.8% vs FTHB=No 2.1%; watch for correlation with reserves <2 months at 6.9% DQ.",
                    "severity": "yellow",
                },
                {
                    "text": "Payment Shock >100% cohort DQ 5.1%; DTI 57+ bucket DQ 4.8% \u2014 stress-index the pipeline.",
                    "severity": "yellow",
                },
                {
                    "text": "Reserves 6\u201312mo DQ 1.3% (vs <2mo 6.9%): reserve tier is the strongest single differentiator.",
                    "severity": "green",
                },
            ],
            "actionItems": [
                {"text": "Ignored in PR A", "category": "monitoring"},
            ],
        }
    )


def _fake_openai_module(mock_client_factory: MagicMock, kind: str) -> types.ModuleType:
    """Stub the ``openai`` module exposing ``AzureOpenAI`` or ``OpenAI``."""
    stub = types.ModuleType("openai")
    if kind == "azure":
        stub.AzureOpenAI = mock_client_factory
        stub.OpenAI = MagicMock(side_effect=AssertionError("LiteLLM path should not run"))
    else:
        stub.OpenAI = mock_client_factory
        stub.AzureOpenAI = MagicMock(side_effect=AssertionError("Azure path should not run"))
    return stub


def _make_client_mock(payload: str) -> MagicMock:
    """Factory Mock whose ``chat.completions.create`` returns ``payload``."""
    client = MagicMock()
    resp = MagicMock()
    resp.choices = [MagicMock(message=MagicMock(content=payload))]
    client.chat.completions.create.return_value = resp
    factory = MagicMock(return_value=client)
    return factory


# ─── Provider selector ──────────────────────────────────────────────────────


def test_azure_success_path_returns_6_bullets_with_valid_severity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None
) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4-brady")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "sekret-key")
    monkeypatch.setenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")

    bs = _load_build_snapshot(tmp_path)
    factory = _make_client_mock(_canned_bullets_payload())
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="azure"))

    bullets = bs.build_risk_factor_bullets(_minimal_snapshot())

    # Correct Azure kwargs
    factory.assert_called_once()
    kw = factory.call_args.kwargs
    assert kw["azure_endpoint"] == "https://example.cognitiveservices.azure.com/"
    assert kw["api_version"] == "2025-01-01-preview"
    assert kw["api_key"] == "sekret-key"

    created_kw = factory.return_value.chat.completions.create.call_args.kwargs
    assert created_kw["model"] == "gpt-4-brady"
    assert created_kw["response_format"] == {"type": "json_object"}
    # Temperature + token budget mirror aiAnalysis.ts (0.3 / 4000).
    assert created_kw["temperature"] == 0.3
    assert created_kw["max_tokens"] == 4000
    # System prompt was passed \u2014 spot-check it came from the shared file.
    system_msg = next(m for m in created_kw["messages"] if m["role"] == "system")
    assert "HUD Compare Ratio Committee" in system_msg["content"]

    assert isinstance(bullets, list)
    assert len(bullets) == 6
    for b in bullets:
        assert set(b.keys()) == {"text", "severity"}
        assert b["severity"] in {"red", "yellow", "green", "neutral"}
        assert b["text"]


def test_litellm_fallback_path_returns_bullets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None
) -> None:
    monkeypatch.setenv("AFN_LITELLM_API_KEY", "sk-litellm")
    # Azure vars intentionally unset

    bs = _load_build_snapshot(tmp_path)
    factory = _make_client_mock(_canned_bullets_payload())
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="litellm"))

    bullets = bs.build_risk_factor_bullets(_minimal_snapshot())

    factory.assert_called_once()
    kw = factory.call_args.kwargs
    # Default LiteLLM base URL + gpt-4o when overrides unset (parity with build_ai_insights).
    assert kw["base_url"] == "http://100.120.169.17:4000/v1"
    assert kw["api_key"] == "sk-litellm"

    created_kw = factory.return_value.chat.completions.create.call_args.kwargs
    assert created_kw["model"] == "gpt-4o"

    assert len(bullets) == 6
    for b in bullets:
        assert b["severity"] in {"red", "yellow", "green", "neutral"}


def test_returns_empty_when_no_provider_configured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None, capsys: pytest.CaptureFixture[str]
) -> None:
    bs = _load_build_snapshot(tmp_path)

    bullets = bs.build_risk_factor_bullets(_minimal_snapshot())

    assert bullets == []
    captured = capsys.readouterr().out
    assert "no AI provider configured" in captured
    assert "dropping bullets" in captured


def test_azure_takes_precedence_over_litellm(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None
) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4-brady")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "sekret-key")
    monkeypatch.setenv("AFN_LITELLM_API_KEY", "sk-litellm-should-not-be-used")

    bs = _load_build_snapshot(tmp_path)
    factory = _make_client_mock(_canned_bullets_payload())
    # Route Azure factory; the fake_openai_module makes the LiteLLM class raise if called.
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="azure"))

    bullets = bs.build_risk_factor_bullets(_minimal_snapshot())
    factory.assert_called_once()
    assert len(bullets) == 6


# ─── Response parsing / robustness ──────────────────────────────────────────


def test_returns_empty_on_malformed_json_response(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4-brady")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "sekret-key")

    bs = _load_build_snapshot(tmp_path)
    factory = _make_client_mock("this is not JSON at all { \"unterminated")
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="azure"))

    bullets = bs.build_risk_factor_bullets(_minimal_snapshot())
    assert bullets == []
    captured = capsys.readouterr().out
    assert "non-JSON" in captured


def test_returns_empty_when_response_missing_executive_summary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4-brady")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "sekret-key")

    bs = _load_build_snapshot(tmp_path)
    # Valid JSON but missing the required key.
    factory = _make_client_mock(json.dumps({"actionItems": []}))
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="azure"))

    bullets = bs.build_risk_factor_bullets(_minimal_snapshot())
    assert bullets == []
    captured = capsys.readouterr().out
    assert "executiveSummary" in captured


def test_returns_empty_when_prompt_file_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4-brady")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "sekret-key")

    bs = _load_build_snapshot(tmp_path)
    # Point at a path that does not exist.
    monkeypatch.setattr(bs, "RISK_FACTOR_PROMPT_PATH", tmp_path / "does-not-exist.md")

    # Fake openai so that IF we got as far as calling it, we'd still fail loudly.
    factory = MagicMock(side_effect=AssertionError("LLM should NOT be called when prompt is missing"))
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="azure"))

    bullets = bs.build_risk_factor_bullets(_minimal_snapshot())
    assert bullets == []
    captured = capsys.readouterr().out
    assert "risk-factor prompt missing" in captured


def test_bullets_with_unknown_severity_normalize_to_neutral(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None
) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4-brady")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "sekret-key")

    bs = _load_build_snapshot(tmp_path)
    factory = _make_client_mock(
        json.dumps(
            {
                "executiveSummary": [
                    {"text": "Valid bullet.", "severity": "puce"},  # unknown \u2192 neutral
                    {"text": "Another valid bullet.", "severity": "RED"},  # case-insensitive
                ]
            }
        )
    )
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="azure"))

    bullets = bs.build_risk_factor_bullets(_minimal_snapshot())
    assert len(bullets) == 2
    assert bullets[0]["severity"] == "neutral"
    assert bullets[1]["severity"] == "red"


def test_facts_string_is_stable_on_minimal_snapshot(tmp_path: Path, clean_env: None) -> None:
    """`_build_risk_factor_facts` must never raise on a minimal snapshot."""
    bs = _load_build_snapshot(tmp_path)
    facts = bs._build_risk_factor_facts(_minimal_snapshot())
    assert isinstance(facts, str)
    # Sanity: the top-level scaffold headers should be present regardless
    # of whether the snapshot carried real portfolio data.
    for expected in (
        "FHA LOAN PORTFOLIO ANALYSIS DATA:",
        "PORTFOLIO OVERVIEW:",
        "CHANNEL COMPARISON:",
        "UNDERWRITING & RISK FACTOR TRENDS:",
        "KEY THRESHOLDS:",
    ):
        assert expected in facts
