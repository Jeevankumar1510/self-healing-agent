"""Validated environment-backed settings for the application."""

from __future__ import annotations

import os
import math
from dataclasses import dataclass
from typing import Mapping


class SettingsError(ValueError):
    """Raised when an application setting is invalid."""


@dataclass(frozen=True)
class Settings:
    monitoring_interval_seconds: int = 10
    cpu_warning_percent: float = 85.0
    memory_warning_percent: float = 85.0
    disk_free_warning_percent: float = 10.0

    @classmethod
    def from_environment(cls, environ: Mapping[str, str] | None = None) -> Settings:
        values = os.environ if environ is None else environ
        interval = _read_int(values, "SHA_MONITORING_INTERVAL_SECONDS", 10)
        cpu = _read_float(values, "SHA_CPU_WARNING_PERCENT", 85.0)
        memory = _read_float(values, "SHA_MEMORY_WARNING_PERCENT", 85.0)
        disk = _read_float(values, "SHA_DISK_FREE_WARNING_PERCENT", 10.0)

        if not 2 <= interval <= 300:
            raise SettingsError("SHA_MONITORING_INTERVAL_SECONDS must be between 2 and 300.")
        for name, value in (
            ("SHA_CPU_WARNING_PERCENT", cpu),
            ("SHA_MEMORY_WARNING_PERCENT", memory),
            ("SHA_DISK_FREE_WARNING_PERCENT", disk),
        ):
            if not math.isfinite(value) or not 0 <= value <= 100:
                raise SettingsError(f"{name} must be between 0 and 100.")

        return cls(
            monitoring_interval_seconds=interval,
            cpu_warning_percent=cpu,
            memory_warning_percent=memory,
            disk_free_warning_percent=disk,
        )


def _read_int(values: Mapping[str, str], name: str, default: int) -> int:
    raw_value = values.get(name)
    if raw_value is None:
        return default
    try:
        return int(raw_value)
    except ValueError as exc:
        raise SettingsError(f"{name} must be an integer.") from exc


def _read_float(values: Mapping[str, str], name: str, default: float) -> float:
    raw_value = values.get(name)
    if raw_value is None:
        return default
    try:
        return float(raw_value)
    except ValueError as exc:
        raise SettingsError(f"{name} must be a number.") from exc
