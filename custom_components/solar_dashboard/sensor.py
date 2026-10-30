"""Summary sensors computed from the daily totals."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfEnergy
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .coordinator import SolarCoordinator

Data = dict[str, float]


def _sum_prefix(data: Data, prefix: str) -> float | None:
    vals = [v for k, v in data.items() if k.startswith(prefix)]
    return sum(vals) if vals else None


def _today(data: Data, today: date) -> float | None:
    return data.get(today.isoformat())


def _yesterday(data: Data, today: date) -> float | None:
    return data.get((today - timedelta(days=1)).isoformat())


def _week(data: Data, today: date) -> float | None:
    start = today - timedelta(days=today.weekday())  # Monday
    vals = [
        data[d]
        for i in range((today - start).days + 1)
        if (d := (start + timedelta(days=i)).isoformat()) in data
    ]
    return sum(vals) if vals else None


def _month(data: Data, today: date) -> float | None:
    return _sum_prefix(data, today.strftime("%Y-%m-"))


def _year(data: Data, today: date) -> float | None:
    return _sum_prefix(data, f"{today.year}-")


def _lifetime(data: Data, today: date) -> float | None:
    return sum(data.values()) if data else None


def _avg_month(data: Data, today: date) -> float | None:
    vals = [v for k, v in data.items() if k.startswith(today.strftime("%Y-%m-"))]
    return sum(vals) / len(vals) if vals else None


def _best(data: Data, today: date) -> float | None:
    return max(data.values()) if data else None


def _best_attrs(data: Data, today: date) -> dict[str, Any]:
    if not data:
        return {}
    day, _ = max(data.items(), key=lambda kv: kv[1])
    return {"date": day}


@dataclass(frozen=True, kw_only=True)
class SolarSensorDescription(SensorEntityDescription):
    value_fn: Callable[[Data, date], float | None]
    attrs_fn: Callable[[Data, date], dict[str, Any]] | None = None


def _desc(key: str, name: str, fn, attrs=None) -> SolarSensorDescription:
    return SolarSensorDescription(
        key=key,
        name=name,
        device_class=SensorDeviceClass.ENERGY,
        native_unit_of_measurement=UnitOfEnergy.KILO_WATT_HOUR,
        suggested_display_precision=1,
        value_fn=fn,
        attrs_fn=attrs,
    )


SENSORS: tuple[SolarSensorDescription, ...] = (
    _desc("today", "Today", _today),
    _desc("yesterday", "Yesterday", _yesterday),
    _desc("week", "This week", _week),
    _desc("month", "This month", _month),
    _desc("year", "This year", _year),
    _desc("lifetime", "Lifetime", _lifetime),
    _desc("avg_month", "Average per day this month", _avg_month),
    _desc("best_day", "Best day", _best, _best_attrs),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: SolarCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(SolarSensor(coordinator, entry, d) for d in SENSORS)


class SolarSensor(CoordinatorEntity[SolarCoordinator], SensorEntity):
    """One summary value."""

    _attr_has_entity_name = True
    entity_description: SolarSensorDescription

    def __init__(
        self,
        coordinator: SolarCoordinator,
        entry: ConfigEntry,
        description: SolarSensorDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Solar Dashboard",
            manufacturer="Custom",
        )

    @property
    def native_value(self) -> float | None:
        if not self.coordinator.data:
            return None
        val = self.entity_description.value_fn(
            self.coordinator.data, dt_util.now().date()
        )
        return round(val, 2) if val is not None else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        fn = self.entity_description.attrs_fn
        if fn is None or not self.coordinator.data:
            return None
        return fn(self.coordinator.data, dt_util.now().date())
