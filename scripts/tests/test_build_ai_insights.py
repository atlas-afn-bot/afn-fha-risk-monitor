"""Unit tests for ``build_ai_insights`` provider selection in
``scripts/build-snapshot.py``.

These verify the three-branch selector:

1. Azure OpenAI path when all four ``AZURE_OPENAI_*`` env vars are set.
2. LiteLLM fallback path when only ``AFN_LITELLM_API_KEY`` is set.
3. Canned fallback when nothing is configured.

The tests stub the ``openai`` module's ``AzureOpenAI`` and ``OpenAI``
clients so no network I/O occurs.
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
    """Import ``scripts/build-snapshot.py`` as a module."""
    os.environ["SNAPSHOT_SOURCE_ROOT"] = str(source_root)
    mod_name = "build_snapshot_under_test_ai"
    sys.modules.pop(mod_name, None)
    spec = importlib.util.spec_from_file_location(mod_name, str(BUILD_SCRIPT))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)  # type: ignore[attr-defined]
    return module


@pytest.fixture()
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear all AI-related env vars so each test controls the selector."""
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
    """A snapshot skeleton with just enough shape for ``_build_ai_facts``.

    ``_build_ai_facts`` reads ``snapshot_meta.label`` and a handful of
    optional list keys — all defaulted with ``.get(...)`` — so this is
    intentionally minimal.
    """
    return {
        "snapshot_meta": {"label": "June 2026"},
        "compare_ratios_total": [],
        "compare_ratios_hoc": [],
        "compare_ratios_hud_office": [],
        "portfolio_slices": [],
        "loan_officer_performance": [],
        "risk_indicator_distribution": [],
        "projections": None,
    }


def _canned_response_payload() -> str:
    """A minimal-but-valid `insights` JSON payload the LLM would return."""
    return json.dumps(
        {
            "insights": [
                {
                    "icon": "trending-up",
                    "tone": "red",
                    "title": "Compare ratio outlier: HOC X at 245",
                    "body": "HOC X compare ratio hit 245 vs peer median 118 on 412 loans.",
                },
                {
                    "icon": "alert-triangle",
                    "tone": "yellow",
                    "title": "DPA program drift in Program Y",
                    "body": "Program Y share climbed from 12% to 21% MoM across 89 loans.",
                },
                {
                    "icon": "activity",
                    "tone": "blue",
                    "title": "Channel mix shift",
                    "body": "Wholesale share now 34% of endorsements, up from 28% last quarter.",
                },
                {
                    "icon": "map-pin",
                    "tone": "green",
                    "title": "Denver HUD office normalizing",
                    "body": "Denver office compare ratio fell from 178 to 142 over 3 months.",
                },
            ]
        }
    )


def _fake_openai_module(mock_client_factory: MagicMock, kind: str) -> types.ModuleType:
    """Build a stub ``openai`` module exposing ``AzureOpenAI`` or ``OpenAI``.

    ``kind`` is 'azure' or 'litellm'. The other class is also present but
    routed to a different mock so tests can assert which one was used.
    """
    stub = types.ModuleType("openai")
    if kind == "azure":
        stub.AzureOpenAI = mock_client_factory
        stub.OpenAI = MagicMock(side_effect=AssertionError("LiteLLM path should not run"))
    else:
        stub.OpenAI = mock_client_factory
        stub.AzureOpenAI = MagicMock(side_effect=AssertionError("Azure path should not run"))
    return stub


def _make_client_mock(payload: str) -> MagicMock:
    """Return a factory Mock whose ``chat.completions.create`` returns ``payload``."""
    client = MagicMock()
    resp = MagicMock()
    resp.choices = [MagicMock(message=MagicMock(content=payload))]
    client.chat.completions.create.return_value = resp
    factory = MagicMock(return_value=client)
    return factory


def test_azure_path_selected_when_all_azure_vars_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None
) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4-brady")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "sekret-key")
    monkeypatch.setenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")

    bs = _load_build_snapshot(tmp_path)

    factory = _make_client_mock(_canned_response_payload())
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="azure"))

    insights = bs.build_ai_insights(_minimal_snapshot())

    # Client was instantiated with the correct Azure kwargs.
    factory.assert_called_once()
    kwargs = factory.call_args.kwargs
    assert kwargs["azure_endpoint"] == "https://example.cognitiveservices.azure.com/"
    assert kwargs["api_version"] == "2025-01-01-preview"
    assert kwargs["api_key"] == "sekret-key"

    # chat.completions.create was called with model=<deployment>.
    created_kwargs = factory.return_value.chat.completions.create.call_args.kwargs
    assert created_kwargs["model"] == "gpt-4-brady"
    assert created_kwargs["response_format"] == {"type": "json_object"}

    # 4 valid insights parsed through.
    assert isinstance(insights, list)
    assert len(insights) == 4
    for item in insights:
        for field in ("icon", "tone", "title", "body"):
            assert field in item


def test_azure_path_uses_default_api_version_when_unset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None
) -> None:
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4-brady")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "sekret-key")
    # No AZURE_OPENAI_API_VERSION set — should default.

    bs = _load_build_snapshot(tmp_path)
    factory = _make_client_mock(_canned_response_payload())
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="azure"))

    bs.build_ai_insights(_minimal_snapshot())
    assert factory.call_args.kwargs["api_version"] == "2025-01-01-preview"


def test_litellm_fallback_when_only_litellm_key_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None
) -> None:
    monkeypatch.setenv("AFN_LITELLM_API_KEY", "sk-litellm")
    # Azure vars intentionally unset.

    bs = _load_build_snapshot(tmp_path)
    factory = _make_client_mock(_canned_response_payload())
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="litellm"))

    insights = bs.build_ai_insights(_minimal_snapshot())

    factory.assert_called_once()
    kwargs = factory.call_args.kwargs
    # Default LiteLLM base url + gpt-4o model when overrides unset.
    assert kwargs["base_url"] == "http://100.120.169.17:4000/v1"
    assert kwargs["api_key"] == "sk-litellm"

    created_kwargs = factory.return_value.chat.completions.create.call_args.kwargs
    assert created_kwargs["model"] == "gpt-4o"

    assert len(insights) == 4


def test_fallback_when_no_provider_configured(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None
) -> None:
    bs = _load_build_snapshot(tmp_path)

    # No openai stub needed — code path returns before importing the client.
    insights = bs.build_ai_insights(_minimal_snapshot())

    assert insights == list(bs._FALLBACK_AI_INSIGHTS)


def test_azure_takes_precedence_when_both_are_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, clean_env: None
) -> None:
    """If both Azure and LiteLLM env vars are present, Azure wins."""
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://example.cognitiveservices.azure.com/")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4-brady")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "sekret-key")
    monkeypatch.setenv("AFN_LITELLM_API_KEY", "sk-litellm-should-not-be-used")

    bs = _load_build_snapshot(tmp_path)
    factory = _make_client_mock(_canned_response_payload())
    monkeypatch.setitem(sys.modules, "openai", _fake_openai_module(factory, kind="azure"))

    insights = bs.build_ai_insights(_minimal_snapshot())

    # Azure factory was used (LiteLLM stub would AssertionError if called).
    factory.assert_called_once()
    assert factory.call_args.kwargs["azure_endpoint"].startswith("https://example")
    assert len(insights) == 4
