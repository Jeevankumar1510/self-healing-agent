"""Local read-only metrics API."""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
import psutil

from agents.diagnosis import (
    DiagnosisConfigurationError,
    DiagnosisPlan,
    DiagnosisProviderError,
    DiagnosisRequest,
    create_diagnosis,
    provider_status,
)
from config.settings import Settings, SettingsError
from memory.activity_repository import ActivityRepository
from monitoring.system_monitor import SystemMonitor

app = FastAPI(
    title="Self-Healing PC Agent API",
    description="Local, read-only host metrics for the dashboard.",
    version="0.2.0",
)
monitor = SystemMonitor()
activity_repository = ActivityRepository()
logger = logging.getLogger(__name__)


class DiskResponse(BaseModel):
    mountpoint: str
    total_bytes: int
    used_bytes: int
    free_bytes: int
    used_percent: float
    free_percent: float


class ProcessResponse(BaseModel):
    pid: int
    name: str
    status: str
    cpu_percent: float
    memory_percent: float


class MetricsResponse(BaseModel):
    captured_at: datetime
    cpu_percent: float
    memory_total_bytes: int
    memory_used_bytes: int
    memory_available_bytes: int
    memory_percent: float
    disks: list[DiskResponse]
    uptime_seconds: float
    process_count: int
    top_processes: list[ProcessResponse]
    python_executable: str
    python_version: str
    platform: str
    warnings: list[str]
    collection_warnings: list[str]
    thresholds: dict[str, float]


class ActivityEventResponse(BaseModel):
    id: str
    occurred_at: datetime
    event_type: str
    title: str
    summary: str
    severity: str
    details: dict[str, Any]


class ActivityListResponse(BaseModel):
    events: list[ActivityEventResponse]
    limit: int
    offset: int


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/diagnosis/status")
def get_diagnosis_status() -> dict[str, str | bool]:
    return provider_status()


@app.post("/api/diagnosis", response_model=DiagnosisPlan)
def diagnose(request: DiagnosisRequest) -> DiagnosisPlan:
    if not request.consent_to_send:
        raise HTTPException(status_code=400, detail="Explicit consent is required before sending diagnostic data.")
    try:
        snapshot = monitor.collect(cpu_interval=0.2)
    except (OSError, psutil.Error) as exc:
        raise HTTPException(status_code=503, detail=f"System metrics are unavailable: {exc}") from exc

    try:
        plan = create_diagnosis(request, snapshot)
    except DiagnosisConfigurationError as exc:
        _record_diagnosis_failure("Provider is not configured.")
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DiagnosisProviderError as exc:
        _record_diagnosis_failure(str(exc))
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    try:
        activity_repository.record_diagnosis(plan)
    except sqlite3.Error as exc:
        logger.exception("Could not save successful diagnosis to local activity history.")
        raise HTTPException(
            status_code=503,
            detail="Diagnosis completed but could not be saved to local history. Check the local database and try again.",
        ) from exc
    return plan


def _record_diagnosis_failure(reason: str) -> None:
    try:
        activity_repository.record_diagnosis_failure(reason=reason)
    except sqlite3.Error:
        logger.exception("Could not save diagnosis failure to local activity history.")


@app.get("/api/activity", response_model=ActivityListResponse)
def get_activity(
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ActivityListResponse:
    try:
        events = activity_repository.list_events(limit=limit, offset=offset)
    except sqlite3.Error as exc:
        logger.exception("Could not read local activity history.")
        raise HTTPException(status_code=503, detail="Local activity history is unavailable.") from exc
    return ActivityListResponse(events=events, limit=limit, offset=offset)


@app.delete("/api/activity")
def delete_activity() -> dict[str, int | str]:
    try:
        deleted = activity_repository.clear()
    except sqlite3.Error as exc:
        logger.exception("Could not clear local activity history.")
        raise HTTPException(status_code=503, detail="Local activity history could not be cleared.") from exc
    return {"deleted": deleted, "status": "cleared"}


@app.get("/api/metrics", response_model=MetricsResponse)
def get_metrics(
    interval: int | None = Query(default=None, ge=2, le=300),
    cpu_threshold: float | None = Query(default=None, ge=0, le=100),
    memory_threshold: float | None = Query(default=None, ge=0, le=100),
    disk_threshold: float | None = Query(default=None, ge=0, le=100),
) -> MetricsResponse:
    try:
        defaults = Settings.from_environment()
        settings = Settings(
            monitoring_interval_seconds=interval if interval is not None else defaults.monitoring_interval_seconds,
            cpu_warning_percent=cpu_threshold if cpu_threshold is not None else defaults.cpu_warning_percent,
            memory_warning_percent=memory_threshold if memory_threshold is not None else defaults.memory_warning_percent,
            disk_free_warning_percent=disk_threshold if disk_threshold is not None else defaults.disk_free_warning_percent,
        )
        snapshot = monitor.collect(cpu_interval=min(0.2, float(settings.monitoring_interval_seconds)))
    except SettingsError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid monitoring configuration: {exc}") from exc
    except (OSError, psutil.Error) as exc:
        raise HTTPException(status_code=503, detail=f"System metrics are unavailable: {exc}") from exc

    warnings: list[str] = []
    if snapshot.cpu_percent >= settings.cpu_warning_percent:
        warnings.append(
            f"CPU is at {snapshot.cpu_percent:.1f}% (warning threshold "
            f"{settings.cpu_warning_percent:.1f}%). This is a single sample, not a confirmed incident."
        )
    if snapshot.memory_percent >= settings.memory_warning_percent:
        warnings.append(
            f"Memory is at {snapshot.memory_percent:.1f}% (warning threshold "
            f"{settings.memory_warning_percent:.1f}%). This is a single sample, not a confirmed incident."
        )

    disks = []
    for disk in snapshot.disks:
        free_percent = 100 - disk.used_percent
        disks.append(
            DiskResponse(
                mountpoint=disk.mountpoint,
                total_bytes=disk.total_bytes,
                used_bytes=disk.used_bytes,
                free_bytes=disk.free_bytes,
                used_percent=disk.used_percent,
                free_percent=free_percent,
            )
        )
        if free_percent <= settings.disk_free_warning_percent:
            warnings.append(
                f"{disk.mountpoint} has {free_percent:.1f}% free "
                f"(warning threshold {settings.disk_free_warning_percent:.1f}%)."
            )

    try:
        activity_repository.record_monitoring_sample(snapshot, warnings)
    except sqlite3.Error as exc:
        logger.exception("Could not save monitoring sample to local activity history.")
        collection_warnings = [
            *snapshot.collection_warnings,
            "This monitoring sample could not be saved to local activity history.",
        ]
    else:
        collection_warnings = list(snapshot.collection_warnings)

    return MetricsResponse(
        captured_at=snapshot.captured_at,
        cpu_percent=snapshot.cpu_percent,
        memory_total_bytes=snapshot.memory_total_bytes,
        memory_used_bytes=snapshot.memory_used_bytes,
        memory_available_bytes=snapshot.memory_available_bytes,
        memory_percent=snapshot.memory_percent,
        disks=disks,
        uptime_seconds=snapshot.uptime_seconds,
        process_count=snapshot.process_count,
        top_processes=[
            ProcessResponse(
                pid=process.pid,
                name=process.name,
                status=process.status,
                cpu_percent=process.cpu_percent,
                memory_percent=process.memory_percent,
            )
            for process in snapshot.top_processes
        ],
        python_executable=snapshot.python_executable,
        python_version=snapshot.python_version,
        platform=snapshot.platform,
        warnings=warnings,
        collection_warnings=collection_warnings,
        thresholds={
            "cpu_percent": settings.cpu_warning_percent,
            "memory_percent": settings.memory_warning_percent,
            "disk_free_percent": settings.disk_free_warning_percent,
        },
    )
