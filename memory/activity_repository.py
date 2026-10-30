"""Persistent, bounded SQLite activity history for local monitoring."""

from __future__ import annotations

import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from agents.diagnosis import DiagnosisPlan, redact_secrets
from monitoring.models import SystemSnapshot

DEFAULT_SAMPLE_INTERVAL_SECONDS = 60
RETENTION_DAYS = 30
MAX_ACTIVITY_ROWS = 20_000
SECRET_KEY = re.compile(r"(?i)(api[_-]?key|access[_-]?token|password|secret|authorization)")
_SECRET_VALUE = object()


def _database_path(path: str | Path | None = None) -> Path:
    if path is not None:
        return Path(path)
    configured = os.environ.get("SHA_DATABASE_PATH")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[1] / "data" / "agent.db"


class ActivityRepository:
    """Persist low-sensitivity monitoring samples and diagnostic outcomes."""

    def __init__(
        self,
        path: str | Path | None = None,
        *,
        sample_interval_seconds: int = DEFAULT_SAMPLE_INTERVAL_SECONDS,
        retention_days: int = RETENTION_DAYS,
    ) -> None:
        if sample_interval_seconds < 1:
            raise ValueError("sample_interval_seconds must be positive.")
        if retention_days < 1:
            raise ValueError("retention_days must be positive.")
        self.path = _database_path(path)
        self.sample_interval_seconds = sample_interval_seconds
        self.retention_days = retention_days

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA busy_timeout = 5000")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS activity_events (
                    id TEXT PRIMARY KEY,
                    occurred_at TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    details_json TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_activity_occurred_at "
                "ON activity_events(occurred_at DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_activity_event_type "
                "ON activity_events(event_type, occurred_at DESC)"
            )
            with connection:
                yield connection
        finally:
            connection.close()

    def record_monitoring_sample(
        self,
        snapshot: SystemSnapshot,
        warnings: list[str],
    ) -> bool:
        occurred_at = snapshot.captured_at.astimezone(timezone.utc)
        details = {
            "cpu_percent": round(snapshot.cpu_percent, 1),
            "memory_percent": round(snapshot.memory_percent, 1),
            "memory_used_bytes": snapshot.memory_used_bytes,
            "memory_total_bytes": snapshot.memory_total_bytes,
            "process_count": snapshot.process_count,
            "readable_disk_count": len(snapshot.disks),
            "warnings": len(warnings),
        }
        disk_percentages = [
            round(100 - disk.used_percent, 1)
            for disk in snapshot.disks
        ]
        if disk_percentages:
            details["lowest_disk_free_percent"] = min(disk_percentages)

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            latest = connection.execute(
                "SELECT occurred_at FROM activity_events "
                "WHERE event_type = 'monitoring_sample' ORDER BY occurred_at DESC LIMIT 1"
            ).fetchone()
            if latest is not None:
                latest_at = datetime.fromisoformat(latest["occurred_at"])
                if occurred_at - latest_at < timedelta(seconds=self.sample_interval_seconds):
                    return False

            title = "System health check"
            summary = (
                f"CPU {details['cpu_percent']:.1f}% · memory {details['memory_percent']:.1f}% · "
                f"{len(snapshot.disks)} readable volume(s) · {len(warnings)} warning(s)"
            )
            self._insert_event(
                connection,
                occurred_at=occurred_at,
                event_type="monitoring_sample",
                title=title,
                summary=summary,
                severity="warning" if warnings else "info",
                details=details,
            )
            self._prune(connection, occurred_at)
            return True

    def record_diagnosis(self, plan: DiagnosisPlan, *, occurred_at: datetime | None = None) -> str:
        timestamp = (occurred_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        details = _sanitize_value(plan.model_dump(mode="json"))
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            event_id = self._insert_event(
                connection,
                occurred_at=timestamp,
                event_type="diagnosis",
                title="AI diagnosis completed",
                summary=(
                    f"{plan.incident_type.replace('_', ' ')} · {plan.severity} severity · "
                    f"{len(plan.possible_causes)} possible cause(s)"
                ),
                severity=plan.severity,
                details=details,
            )
            self._prune(connection, timestamp)
            return event_id

    def record_diagnosis_failure(
        self,
        *,
        reason: str,
        occurred_at: datetime | None = None,
    ) -> str:
        timestamp = (occurred_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        summary = redact_secrets(reason)[:500]
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            event_id = self._insert_event(
                connection,
                occurred_at=timestamp,
                event_type="diagnosis_failure",
                title="AI diagnosis failed",
                summary=summary,
                severity="warning",
                details={},
            )
            self._prune(connection, timestamp)
            return event_id

    def list_events(self, *, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        if not 1 <= limit <= 200:
            raise ValueError("limit must be between 1 and 200.")
        if offset < 0:
            raise ValueError("offset cannot be negative.")
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, occurred_at, event_type, title, summary, severity, details_json
                FROM activity_events
                ORDER BY occurred_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "occurred_at": row["occurred_at"],
                "event_type": row["event_type"],
                "title": row["title"],
                "summary": row["summary"],
                "severity": row["severity"],
                "details": json.loads(row["details_json"]),
            }
            for row in rows
        ]

    def clear(self) -> int:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            count = connection.execute("SELECT COUNT(*) FROM activity_events").fetchone()[0]
            connection.execute("DELETE FROM activity_events")
            return int(count)

    @staticmethod
    def _insert_event(
        connection: sqlite3.Connection,
        *,
        occurred_at: datetime,
        event_type: str,
        title: str,
        summary: str,
        severity: str,
        details: dict[str, Any],
    ) -> str:
        event_id = str(uuid4())
        connection.execute(
            """
            INSERT INTO activity_events
                (id, occurred_at, event_type, title, summary, severity, details_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                occurred_at.isoformat(),
                event_type,
                title,
                redact_secrets(summary)[:1000],
                severity,
                json.dumps(_sanitize_value(details), ensure_ascii=True),
            ),
        )
        return event_id

    def _prune(self, connection: sqlite3.Connection, now: datetime) -> None:
        expiry = (now - timedelta(days=self.retention_days)).isoformat()
        connection.execute("DELETE FROM activity_events WHERE occurred_at < ?", (expiry,))
        connection.execute(
            """
            DELETE FROM activity_events
            WHERE id IN (
                SELECT id FROM activity_events
                ORDER BY occurred_at DESC, id DESC
                LIMIT -1 OFFSET ?
            )
            """,
            (MAX_ACTIVITY_ROWS,),
        )


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_secrets(value)[:3000]
    if isinstance(value, dict):
        return {
            str(key): ("[REDACTED]" if SECRET_KEY.search(str(key)) else _sanitize_value(item))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_sanitize_value(item) for item in value[:50]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:3000]
