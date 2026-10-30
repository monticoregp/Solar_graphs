"""Solar Dashboard: native graphs for daily solar production totals."""
from __future__ import annotations

from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import CARD_FILE, DOMAIN, URL_BASE, VERSION
from .coordinator import SolarCoordinator

PLATFORMS = ["sensor"]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the Lovelace card JS and the websocket command (once)."""
    hass.data.setdefault(DOMAIN, {})

    card_path = Path(__file__).parent / "frontend" / CARD_FILE
    await hass.http.async_register_static_paths(
        [StaticPathConfig(f"{URL_BASE}/{CARD_FILE}", str(card_path), False)]
    )
    # Auto-load the card on every dashboard. If this doesn't take on your HA,
    # add the URL manually as a dashboard resource (see README).
    frontend.add_extra_js_url(hass, f"{URL_BASE}/{CARD_FILE}?v={VERSION}")

    websocket_api.async_register_command(hass, ws_get_data)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator = SolarCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    hass.data[DOMAIN][entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unloaded


async def _update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "solar_dashboard/data",
        vol.Optional("entry_id"): str,
        vol.Optional("refresh", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_get_data(hass: HomeAssistant, connection, msg) -> None:
    """Return all daily totals to the card (goes through HA's own origin)."""
    coordinators: dict[str, SolarCoordinator] = hass.data.get(DOMAIN, {})
    coordinator = coordinators.get(msg.get("entry_id")) or next(
        iter(coordinators.values()), None
    )
    if coordinator is None:
        connection.send_error(msg["id"], "not_found", "Solar Dashboard is not set up")
        return

    if msg["refresh"]:
        await coordinator.async_refresh()

    days = sorted(coordinator.data.items()) if coordinator.data else []
    connection.send_result(msg["id"], {"days": days})
