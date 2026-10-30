import json
from datetime import datetime, timezone
from urllib.request import Request

import pytest

from agents.diagnosis import (
    DiagnosisProviderError,
    DiagnosisPlan,
    DiagnosisRequest,
    PossibleCause,
    create_diagnosis,
    redact_secrets,
)
from monitoring.models import DiskMetric, ProcessMetric, SystemSnapshot


def _snapshot() -> SystemSnapshot:
    return SystemSnapshot(
        captured_at=datetime.now(timezone.utc),
        cpu_percent=42.0,
        memory_total_bytes=1000,
        memory_used_bytes=500,
        memory_available_bytes=500,
        memory_percent=50.0,
        disks=(DiskMetric("C:\\Private", 1000, 700, 300, 70.0),),
        uptime_seconds=1200,
        process_count=1,
        top_processes=(ProcessMetric(123, "private-process.exe", "running", 0.0, 2.0),),
        python_executable="C:\\Python\\python.exe",
        python_version="3.12.0",
        platform="Windows",
    )


def _plan() -> DiagnosisPlan:
    return DiagnosisPlan(
        incident_type="python_error",
        severity="medium",
        observations=["The user reported an import failure."],
        possible_causes=[
            PossibleCause(
                cause="The dependency may be missing.",
                likelihood=0.6,
                rationale="The report describes an import failure; package state was not checked.",
            )
        ],
        recommended_checks=["Inspect the active interpreter and package list."],
        proposed_fix="Install the package in the selected environment only if the check confirms it is missing.",
        requires_approval=True,
        verification="Repeat the original import using the same interpreter.",
        uncertainties=["The package and interpreter were not provided."],
    )


def test_redact_secrets_removes_common_credentials() -> None:
    text = "password=private-value Bearer token-123 sk-123456789012"

    redacted = redact_secrets(text)

    assert "private-value" not in redacted
    assert "token-123" not in redacted
    assert "sk-123456789012" not in redacted
    assert redacted.count("[REDACTED]") == 3


def test_missing_api_key_fails_before_provider_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="credentials are not configured"):
        create_diagnosis(
            DiagnosisRequest(problem_description="An application reports an import error.", consent_to_send=True),
            _snapshot(),
        )


def test_diagnosis_sends_redacted_report_and_minimal_host_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
    recorded: dict[str, object] = {}
    plan = _plan()

    def sender(request: Request, timeout: float) -> bytes:
        recorded["url"] = request.full_url
        recorded["authorization"] = request.get_header("Authorization")
        recorded["timeout"] = timeout
        recorded["payload"] = json.loads(request.data)
        return json.dumps(
            {"choices": [{"message": {"content": plan.model_dump_json(), "refusal": None}}]}
        ).encode()

    result = create_diagnosis(
        DiagnosisRequest(
            problem_description="My problem shows password=super-secret while importing a package.",
            consent_to_send=True,
        ),
        _snapshot(),
        sender=sender,
    )

    payload = str(recorded["payload"])
    assert result == plan
    assert recorded["url"] == "https://api.openai.com/v1/chat/completions"
    assert recorded["authorization"] == "Bearer test-key-not-real"
    assert recorded["timeout"] == 30.0
    assert "super-secret" not in payload
    assert "private-process.exe" not in payload
    assert "C:\\Private" not in payload
    assert '"pid"' not in payload
    assert "42.0%" in payload


def test_provider_refusal_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")

    def sender(request: Request, timeout: float) -> bytes:
        return json.dumps(
            {"choices": [{"message": {"content": None, "refusal": "declined"}}]}
        ).encode()

    with pytest.raises(DiagnosisProviderError, match="declined"):
        create_diagnosis(
            DiagnosisRequest(problem_description="My application keeps crashing unexpectedly.", consent_to_send=True),
            _snapshot(),
            sender=sender,
        )


def test_invalid_provider_payload_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")

    def sender(request: Request, timeout: float) -> bytes:
        return b'{"choices":[{"message":{"content":"{}"}}]}'

    with pytest.raises(DiagnosisProviderError, match="invalid structured diagnosis"):
        create_diagnosis(
            DiagnosisRequest(problem_description="My application keeps crashing unexpectedly.", consent_to_send=True),
            _snapshot(),
            sender=sender,
        )
