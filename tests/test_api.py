from dataclasses import replace
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from api import main
from agents.diagnosis import DiagnosisPlan
from monitoring.models import DiskMetric, ProcessMetric, SystemSnapshot


client = TestClient(main.app)


@pytest.fixture(autouse=True)
def isolate_activity_database(monkeypatch, tmp_path) -> None:
    from memory.activity_repository import ActivityRepository

    monkeypatch.setattr(
        main,
        "activity_repository",
        ActivityRepository(tmp_path / "activity.db"),
    )


def _snapshot(cpu: float = 25.0) -> SystemSnapshot:
    return SystemSnapshot(
        captured_at=datetime.now(timezone.utc),
        cpu_percent=cpu,
        memory_total_bytes=1000,
        memory_used_bytes=500,
        memory_available_bytes=500,
        memory_percent=50.0,
        disks=(DiskMetric("C:\\", 1000, 900, 100, 90.0),),
        uptime_seconds=3600.0,
        process_count=1,
        top_processes=(ProcessMetric(123, "test.exe", "running", 1.0, 2.0),),
        python_executable="C:\\Python\\python.exe",
        python_version="3.12.0",
        platform="Windows",
    )


def test_health_endpoint_reports_local_service() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_metrics_endpoint_returns_real_monitor_snapshot(monkeypatch) -> None:
    monkeypatch.setattr(main.monitor, "collect", lambda **kwargs: _snapshot())

    response = client.get("/api/metrics")

    assert response.status_code == 200
    body = response.json()
    assert body["cpu_percent"] == 25.0
    assert body["disks"][0]["free_percent"] == 10.0
    assert body["top_processes"][0]["name"] == "test.exe"
    assert body["thresholds"]["cpu_percent"] == 85.0
    assert body["warnings"] == ["C:\\ has 10.0% free (warning threshold 10.0%)."]
    assert body["collection_warnings"] == []
    assert main.activity_repository.list_events()[0]["event_type"] == "monitoring_sample"


def test_metrics_endpoint_flags_threshold_observation(monkeypatch) -> None:
    monkeypatch.setattr(main.monitor, "collect", lambda **kwargs: _snapshot(cpu=91.0))

    response = client.get("/api/metrics?cpu_threshold=90&disk_threshold=11")

    assert response.status_code == 200
    warnings = response.json()["warnings"]
    assert any("CPU is at 91.0%" in warning for warning in warnings)
    assert any("C:\\ has 10.0% free" in warning for warning in warnings)


def test_collection_warning_is_not_a_health_warning(monkeypatch) -> None:
    snapshot = _snapshot()
    monkeypatch.setattr(
        main.monitor,
        "collect",
        lambda **kwargs: replace(
            snapshot,
            collection_warnings=(
                "D:\\ is locked by BitLocker, so its storage usage is unavailable. "
                "Unlock the drive to include it in monitoring.",
            ),
        ),
    )

    response = client.get("/api/metrics")

    assert response.status_code == 200
    body = response.json()
    assert body["warnings"] == ["C:\\ has 10.0% free (warning threshold 10.0%)."]
    assert len(body["collection_warnings"]) == 1


def test_metrics_endpoint_rejects_out_of_range_threshold() -> None:
    response = client.get("/api/metrics?cpu_threshold=101")

    assert response.status_code == 422


def test_diagnosis_status_does_not_expose_api_key(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "must-never-be-returned")
    response = client.get("/api/diagnosis/status")

    assert response.status_code == 200
    assert response.json() == {
        "configured": True,
        "provider": "OpenAI",
        "model": "gpt-4o-mini",
    }
    assert "must-never-be-returned" not in response.text


def test_diagnosis_endpoint_requires_explicit_consent() -> None:
    response = client.post(
        "/api/diagnosis",
        json={"problem_description": "Application has an error.", "consent_to_send": False},
    )

    assert response.status_code == 422


def test_diagnosis_endpoint_reports_missing_provider_credentials(
    monkeypatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(main.monitor, "collect", lambda **kwargs: _snapshot())

    response = client.post(
        "/api/diagnosis",
        json={"problem_description": "My application reports an import error.", "consent_to_send": True},
    )

    assert response.status_code == 503
    assert "credentials are not configured" in response.json()["detail"]


def test_diagnosis_endpoint_returns_structured_plan_after_consent(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")
    monkeypatch.setattr(main.monitor, "collect", lambda **kwargs: _snapshot())
    plan = DiagnosisPlan(
        incident_type="python_error",
        severity="medium",
        observations=["The user reported an import error."],
        possible_causes=[],
        recommended_checks=["Inspect the active Python environment."],
        proposed_fix="Install the package in the chosen environment if confirmed missing.",
        requires_approval=True,
        verification="Repeat the original import test.",
        uncertainties=["The package name was not provided."],
    )
    monkeypatch.setattr(main, "create_diagnosis", lambda request, snapshot: plan)

    response = client.post(
        "/api/diagnosis",
        json={"problem_description": "My application reports an import error.", "consent_to_send": True},
    )

    assert response.status_code == 200
    assert response.json()["incident_type"] == "python_error"
    assert response.json()["requires_approval"] is True
    assert main.activity_repository.list_events()[0]["event_type"] == "diagnosis"


def test_activity_endpoint_lists_and_clears_history(monkeypatch, tmp_path) -> None:
    from memory.activity_repository import ActivityRepository

    monkeypatch.setattr(main, "activity_repository", ActivityRepository(tmp_path / "activity.db"))
    monkeypatch.setattr(main.monitor, "collect", lambda **kwargs: _snapshot())
    metrics_response = client.get("/api/metrics")
    assert metrics_response.status_code == 200

    response = client.get("/api/activity?limit=10")

    assert response.status_code == 200
    assert len(response.json()["events"]) == 1
    assert response.json()["events"][0]["event_type"] == "monitoring_sample"
    assert client.delete("/api/activity").json() == {"deleted": 1, "status": "cleared"}
    assert client.get("/api/activity").json()["events"] == []
