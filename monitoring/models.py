"""Typed values returned by the monitoring layer."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class DiskMetric:
    mountpoint: str
    total_bytes: int
    used_bytes: int
    free_bytes: int
    used_percent: float


@dataclass(frozen=True)
class ProcessMetric:
    pid: int
    name: str
    status: str
    cpu_percent: float
    memory_percent: float


@dataclass(frozen=True)
class SystemSnapshot:
    captured_at: datetime
    cpu_percent: float
    memory_total_bytes: int
    memory_used_bytes: int
    memory_available_bytes: int
    memory_percent: float
    disks: tuple[DiskMetric, ...]
    uptime_seconds: float
    process_count: int
    top_processes: tuple[ProcessMetric, ...]
    python_executable: str
    python_version: str
    platform: str
    collection_warnings: tuple[str, ...] = ()
