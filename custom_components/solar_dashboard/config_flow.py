"""Config flow for Solar Dashboard."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback

from .const import (
    CONF_SCAN_INTERVAL,
    CONF_TOKEN,
    CONF_URL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
)
from .coordinator import SolarFetchError, async_fetch_days

INTERVAL_VALIDATOR = vol.All(vol.Coerce(int), vol.Range(min=1, max=1440))


class SolarDashboardConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the setup UI."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> Any:
        errors: dict[str, str] = {}
        user_input = user_input or {}

        if user_input:
            url = user_input[CONF_URL].strip()
            token = (user_input.get(CONF_TOKEN) or "").strip() or None
            await self.async_set_unique_id(url)
            self._abort_if_unique_id_configured()
            try:
                await async_fetch_days(self.hass, url, token)
            except SolarFetchError:
                errors["base"] = "cannot_connect"
            except ValueError:
                errors["base"] = "invalid_data"
            else:
                data = {
                    CONF_URL: url,
                    CONF_SCAN_INTERVAL: user_input.get(
                        CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL
                    ),
                }
                if token:
                    data[CONF_TOKEN] = token
                return self.async_create_entry(title="Solar Dashboard", data=data)

        schema = vol.Schema(
            {
                vol.Required(
                    CONF_URL, default=user_input.get(CONF_URL, "http://")
                ): str,
                vol.Optional(CONF_TOKEN, default=user_input.get(CONF_TOKEN, "")): str,
                vol.Optional(
                    CONF_SCAN_INTERVAL,
                    default=user_input.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                ): INTERVAL_VALIDATOR,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return SolarDashboardOptionsFlow()


class SolarDashboardOptionsFlow(OptionsFlow):
    """Change the polling interval."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> Any:
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        current = self.config_entry.options.get(
            CONF_SCAN_INTERVAL,
            self.config_entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
        )
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {vol.Required(CONF_SCAN_INTERVAL, default=current): INTERVAL_VALIDATOR}
            ),
        )
