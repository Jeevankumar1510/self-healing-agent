from types import SimpleNamespace

import psutil
import pytest

from monitoring.system_monitor import SystemMonitor


def test_collect_returns_realistically_shaped_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    process = SimpleNamespace(
        info={
            "pid": 42,
            "name": "sample.exe",
            "status": "running",
            "memory_percent": 3.5,
        },
        cpu_percent=lambda interval=None: 2.0,
    )
    monkeypatch.setattr(psutil, "virtual_memory", lambda: SimpleNamespace(
        total=1000, used=400, available=600, percent=40.0
    ))
    monkeypatch.setattr(psutil, "cpu_percent", lambda interval: 25.0)
    monkeypatch.setattr(psutil, "disk_usage", lambda path: SimpleNamespace(
        total=1000, used=700, free=300, percent=70.0
    ))
    monkeypatch.setattr(psutil, "process_iter", lambda **kwargs: [process])
    monkeypatch.setattr(psutil, "boot_time", lambda: 1.0)

    snapshot = SystemMonitor().collect(cpu_interval=0, disk_mountpoints=["C:\\"])

    assert snapshot.cpu_percent == 25.0
    assert snapshot.memory_percent == 40.0
    assert snapshot.disks[0].mountpoint == "C:\\"
    assert snapshot.disks[0].free_bytes == 300
    assert snapshot.process_count == 1
    assert snapshot.top_processes[0].name == "sample.exe"
    assert snapshot.python_executable


def test_inaccessible_disk_is_reported_as_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(psutil, "virtual_memory", lambda: SimpleNamespace(
        total=100, used=50, available=50, percent=50.0
    ))
    monkeypatch.setattr(psutil, "cpu_percent", lambda interval: 0.0)
    monkeypatch.setattr(psutil, "disk_usage", lambda path: (_ for _ in ()).throw(PermissionError("denied")))
    monkeypatch.setattr(psutil, "process_iter", lambda **kwargs: [])
    monkeypatch.setattr(psutil, "boot_time", lambda: 1.0)

    snapshot = SystemMonitor().collect(cpu_interval=0, disk_mountpoints=["X:\\"])

    assert snapshot.disks == ()
    assert snapshot.collection_warnings == (
        "Storage usage for X:\\ is unavailable because access was denied.",
    )


def test_locked_bitlocker_disk_gets_actionable_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(psutil, "virtual_memory", lambda: SimpleNamespace(
        total=100, used=50, available=50, percent=50.0
    ))
    monkeypatch.setattr(psutil, "cpu_percent", lambda interval: 0.0)
    monkeypatch.setattr(
        psutil,
        "disk_usage",
        lambda path: (_ for _ in ()).throw(
            OSError("This drive is locked by BitLocker Drive Encryption.")
        ),
    )
    monkeypatch.setattr(psutil, "process_iter", lambda **kwargs: [])
    monkeypatch.setattr(psutil, "boot_time", lambda: 1.0)

    snapshot = SystemMonitor().collect(cpu_interval=0, disk_mountpoints=["D:\\"])

    assert snapshot.collection_warnings == (
        "D:\\ is locked by BitLocker, so its storage usage is unavailable. "
        "Unlock the drive to include it in monitoring.",
    )


@pytest.mark.parametrize(
    ("cpu_interval", "top_process_count"),
    [(-1, 5), (0, -1)],
)
def test_collect_rejects_invalid_arguments(cpu_interval: float, top_process_count: int) -> None:
    with pytest.raises(ValueError):
        SystemMonitor().collect(cpu_interval=cpu_interval, top_process_count=top_process_count)
