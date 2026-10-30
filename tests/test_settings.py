import pytest

from config.settings import Settings, SettingsError


def test_settings_use_safe_defaults() -> None:
    settings = Settings.from_environment({})

    assert settings.monitoring_interval_seconds == 10
    assert settings.cpu_warning_percent == 85.0
    assert settings.memory_warning_percent == 85.0


def test_settings_read_valid_values() -> None:
    settings = Settings.from_environment(
        {
            "SHA_MONITORING_INTERVAL_SECONDS": "15",
            "SHA_CPU_WARNING_PERCENT": "90",
            "SHA_MEMORY_WARNING_PERCENT": "88.5",
            "SHA_DISK_FREE_WARNING_PERCENT": "12",
        }
    )

    assert settings == Settings(15, 90.0, 88.5, 12.0)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("SHA_MONITORING_INTERVAL_SECONDS", "1"),
        ("SHA_MONITORING_INTERVAL_SECONDS", "301"),
        ("SHA_CPU_WARNING_PERCENT", "101"),
        ("SHA_MEMORY_WARNING_PERCENT", "-1"),
        ("SHA_DISK_FREE_WARNING_PERCENT", "unknown"),
        ("SHA_CPU_WARNING_PERCENT", "nan"),
    ],
)
def test_invalid_settings_are_reported(name: str, value: str) -> None:
    with pytest.raises(SettingsError):
        Settings.from_environment({name: value})
