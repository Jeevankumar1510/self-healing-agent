from datetime import datetime, timedelta, timezone
import json

from agents.diagnosis import DiagnosisPlan, PossibleCause
from memory.activity_repository import ActivityRepository
from monitoring.models import DiskMetric, ProcessMetric, SystemSnapshot


def _snapshot(captured_at: datetime) -> SystemSnapshot:
    return SystemSnapshot(
        captured_at=captured_at,
        cpu_percent=42.25,
        memory_total_bytes=2000,
        memory_used_bytes=900,
        memory_available_bytes=1100,
        memory_percent=45.0,
        disks=(DiskMetric("C:\\Private", 1000, 700, 300, 70.0),),
        uptime_seconds=600,
        process_count=12,
        top_processes=(ProcessMetric(123, "private.exe", "running", 0.0, 1.0),),
        python_executable="C:\\Python\\python.exe",
        python_version="3.12.0",
        platform="Windows",
    )


def _plan() -> DiagnosisPlan:
    return DiagnosisPlan(
        incident_type="python_dependency_error",
        severity="medium",
        observations=["The application reported an import error."],
        possible_causes=[
            PossibleCause(
                cause="The module may not be installed.",
                likelihood=0.7,
                rationale="The reported exception is consistent with a missing module.",
            )
        ],
        recommended_checks=["Inspect the selected interpreter's installed packages."],
        proposed_fix="Install the package in the selected environment if confirmed missing.",
        requires_approval=True,
        verification="Repeat the original import test.",
        uncertainties=["The package name was not provided."],
    )


def test_monitoring_samples_are_throttled_and_persisted(tmp_path) -> None:
    path = tmp_path / "nested" / "agent.db"
    repository = ActivityRepository(path, sample_interval_seconds=60)
    now = datetime.now(timezone.utc)

    assert repository.record_monitoring_sample(_snapshot(now), []) is True
    assert repository.record_monitoring_sample(_snapshot(now + timedelta(seconds=30)), []) is False
    assert repository.record_monitoring_sample(_snapshot(now + timedelta(seconds=61)), ["low disk"]) is True

    events = ActivityRepository(path).list_events()
    assert len(events) == 2
    assert events[0]["event_type"] == "monitoring_sample"
    assert events[0]["details"]["cpu_percent"] == 42.2
    assert "private.exe" not in json.dumps(events)
    assert "C:\\Private" not in json.dumps(events)
    assert '"pid"' not in json.dumps(events)


def test_diagnosis_is_persisted_without_user_report_or_secrets(tmp_path) -> None:
    repository = ActivityRepository(tmp_path / "agent.db")
    plan = _plan().model_copy(
        update={
            "observations": ["Detected password=do-not-store in submitted report."],
        }
    )

    repository.record_diagnosis(plan)

    event = repository.list_events()[0]
    serialized = json.dumps(event)
    assert event["event_type"] == "diagnosis"
    assert event["severity"] == "medium"
    assert "do-not-store" not in serialized
    assert event["details"]["observations"] == ["Detected [REDACTED] in submitted report."]


def test_diagnosis_failure_and_clear_history(tmp_path) -> None:
    repository = ActivityRepository(tmp_path / "agent.db")
    repository.record_diagnosis_failure(reason="provider failed password=private")
    repository.record_monitoring_sample(_snapshot(datetime.now(timezone.utc)), [])

    assert len(repository.list_events()) == 2
    assert repository.clear() == 2
    assert repository.list_events() == []


def test_history_is_limited_and_validates_pagination(tmp_path) -> None:
    repository = ActivityRepository(tmp_path / "agent.db")
    now = datetime.now(timezone.utc)
    repository.record_monitoring_sample(_snapshot(now), [])
    repository.record_diagnosis(_plan(), occurred_at=now + timedelta(seconds=1))

    page = repository.list_events(limit=1, offset=1)

    assert len(page) == 1
    assert page[0]["event_type"] == "monitoring_sample"
