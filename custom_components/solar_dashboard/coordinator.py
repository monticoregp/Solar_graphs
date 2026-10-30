"""Data coordinator: fetches daily kWh totals from the user's server."""
from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from typing import Any

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_SCAN_INTERVAL,
    CONF_TOKEN,
    CONF_URL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

VALUE_KEYS = ("kwh", "value", "total", "energy", "production")


class SolarFetchError(Exception):
    """Raised when the server cannot be reached or returns an error."""


def parse_payload(payload: Any) -> dict[str, float]:
    """Turn the server response into {YYYY-MM-DD: kWh}.

    Accepted shapes:
      [{"date": "2026-10-01", "kwh": 31.2}, ...]
      [["2026-10-01", 31.2], ...]
      {"2026-10-01": 31.2, ...}
      any of the above wrapped in {"data" | "days" | "rows" | "results": ...}
    """
    if isinstance(payload, dict):
        for key in ("data", "days", "rows", "results"):
            if isinstance(payload.get(key), (list, dict)):
                payload = payload[key]
                break

    items: list[tuple[Any, Any]] = []
    if isinstance(payload, dict):
        items = list(payload.items())
    elif isinstance(payload, list):
        for row in payload:
            if isinstance(row, dict):
                day = row.get("date") or row.get("day")
                val = next((row[k] for k in VALUE_KEYS if k in row), None)
                items.append((day, val))
            elif isinstance(row, (list, tuple)) and len(row) >= 2:
                items.append((row[0], row[1]))
    else:
        raise ValueError("Unexpected response format")

    out: dict[str, float] = {}
    for day, val in items:
        try:
            iso = date.fromisoformat(str(day)[:10]).isoformat()
            out[iso] = float(val)
        except (TypeError, ValueError):
            continue
    return out


async def async_fetch_days(
    hass: HomeAssistant, url: str, token: str | None
) -> dict[str, float]:
    """Fetch and parse daily totals. Raises SolarFetchError or ValueError."""
    session = async_get_clientsession(hass)
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        async with session.get(
            url, headers=headers, timeout=aiohttp.ClientTimeout(total=20)
        ) as resp:
            resp.raise_for_status()
            payload = await resp.json(content_type=None)
    except (aiohttp.ClientError, asyncio.TimeoutError) as err:
        raise SolarFetchError(str(err)) from err
    return parse_payload(payload)


class SolarCoordinator(DataUpdateCoordinator[dict[str, float]]):
    """Polls the server for daily totals."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        minutes = entry.options.get(
            CONF_SCAN_INTERVAL,
            entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
        )
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            config_entry=entry,
            update_interval=timedelta(minutes=minutes),
        )
        self._url = entry.data[CONF_URL]
        self._token = entry.data.get(CONF_TOKEN)

    async def _async_update_data(self) -> dict[str, float]:
        try:
            return await async_fetch_days(self.hass, self._url, self._token)
        except SolarFetchError as err:
            raise UpdateFailed(f"Error talking to solar server: {err}") from err
        except ValueError as err:
            raise UpdateFailed(f"Invalid data from solar server: {err}") from err
