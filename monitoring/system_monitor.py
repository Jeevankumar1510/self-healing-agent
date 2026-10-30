"""Collect read-only host metrics using psutil."""

from __future__ import annotations

import platform
import sys
from datetime import datetime, timezone
from typing import Iterable

import psutil

from monitoring.models import DiskMetric, ProcessMetric, SystemSnapshot


class SystemMonitor:
    """Collect a point-in-time snapshot without modifying the host."""

    def collect(
        self,
        *,
        cpu_interval: float = 0.2,
        disk_mountpoints: Iterable[str] | None = None,
        top_process_count: int = 8,
    ) -> SystemSnapshot:
        if cpu_interval < 0:
            raise ValueError("cpu_interval cannot be negative.")
        if top_process_count < 0:
            raise ValueError("top_process_count cannot be negative.")

        warnings: list[str] = []
        memory = psutil.virtual_memory()
        disks = self._collect_disks(disk_mountpoints, warnings)
        processes, process_count = self._collect_processes(warnings)
        processes.sort(key=lambda process: (process.memory_percent, process.cpu_percent), reverse=True)

        return SystemSnapshot(
            captured_at=datetime.now(timezone.utc),
            cpu_percent=psutil.cpu_percent(interval=cpu_interval),
            memory_total_bytes=memory.total,
            memory_used_bytes=memory.used,
            memory_available_bytes=memory.available,
            memory_percent=memory.percent,
            disks=tuple(disks),
            uptime_seconds=max(0.0, datetime.now().timestamp() - psutil.boot_time()),
            process_count=process_count,
            top_processes=tuple(processes[:top_process_count]),
            python_executable=sys.executable,
            python_version=platform.python_version(),
            platform=platform.platform(),
            collection_warnings=tuple(warnings),
        )

    @staticmethod
    def _collect_disks(
        mountpoints: Iterable[str] | None,
        warnings: list[str],
    ) -> list[DiskMetric]:
        if mountpoints is None:
            targets = [partition.mountpoint for partition in psutil.disk_partitions(all=False)]
        else:
            targets = list(dict.fromkeys(mountpoints))

        disks: list[DiskMetric] = []
        for mountpoint in targets:
            try:
                usage = psutil.disk_usage(mountpoint)
            except (OSError, PermissionError) as exc:
                warnings.append(SystemMonitor._describe_disk_error(mountpoint, exc))
                continue
            disks.append(
                DiskMetric(
                    mountpoint=mountpoint,
                    total_bytes=usage.total,
                    used_bytes=usage.used,
                    free_bytes=usage.free,
                    used_percent=usage.percent,
                )
            )
        return disks

    @staticmethod
    def _describe_disk_error(mountpoint: str, error: OSError) -> str:
        message = str(error)
        if getattr(error, "winerror", None) == -2144272384 or "BitLocker Drive Encryption" in message:
            return (
                f"{mountpoint} is locked by BitLocker, so its storage usage is unavailable. "
                "Unlock the drive to include it in monitoring."
            )
        if isinstance(error, PermissionError):
            return f"Storage usage for {mountpoint} is unavailable because access was denied."
        return f"Storage usage for {mountpoint} is unavailable. The volume may be offline or inaccessible."

    @staticmethod
    def _collect_processes(warnings: list[str]) -> tuple[list[ProcessMetric], int]:
        processes: list[ProcessMetric] = []
        process_count = 0
        for process in psutil.process_iter(
            attrs=["pid", "name", "status", "memory_percent"],
            ad_value=None,
        ):
            process_count += 1
            try:
                info = process.info
                processes.append(
                    ProcessMetric(
                        pid=info["pid"],
                        name=info.get("name") or "Unknown",
                        status=info.get("status") or "Unknown",
                        cpu_percent=process.cpu_percent(interval=None),
                        memory_percent=float(info.get("memory_percent") or 0.0),
                    )
                )
            except psutil.AccessDenied as exc:
                warnings.append(f"Could not inspect process {process.pid}: {exc}")
            except (psutil.NoSuchProcess, psutil.ZombieProcess):
                continue
        return processes, process_count
