# Solar Dashboard (Home Assistant custom integration)

Native solar production graphs for Home Assistant, built from daily kWh totals
stored in your SQLite database. No iframe or URL card, so no http/https
mixed-content errors.

## How it works

```
HA automation -> rest_command -> your server -> solar_data.db   (unchanged)
                                      |
              GET /solar/daily  (JSON, read by the HA backend)
                                      |
                  Solar Dashboard integration (coordinator + sensors)
                                      |
                 HA websocket (same origin as your dashboard)
                                      |
                       custom:solar-dashboard-card (SVG charts)
```

Home Assistant's backend fetches the JSON, so the http server never has to be
reachable from your browser. The card only talks to HA itself, so it works
locally, over HTTPS, and through Nabu Cloud.

## Install with HACS

1. Push this repository to GitHub (the repo root must contain `custom_components/`, `hacs.json` and `README.md`).
2. Replace `YOUR_GITHUB_USERNAME` in `custom_components/solar_dashboard/manifest.json` with your GitHub username.
3. Create a release (e.g. tag `v1.0.0`; keep it in step with `version` in the manifest). HACS offers releases when they exist, otherwise the default branch.
4. In HA: HACS > three-dot menu > Custom repositories > add the repo URL, category **Integration**.
5. Download "Solar Dashboard" in HACS, restart HA, then continue from step 2 below.

## 1. Server: add the JSON endpoint

Copy the query and route from `server/solar_daily_endpoint.py` into your
existing Python receiver (or run it as a second small service). Edit
`TABLE`, `DATE_COL` and `KWH_COL` to match `solar_data.db`.

Test it: `curl http://YOUR_SERVER:5001/solar/daily`

Accepted response shapes: a list of `{"date": ..., "kwh": ...}` objects, a list
of `[date, kwh]` pairs, or a `{date: kwh}` object (optionally wrapped in
`data`/`days`/`rows`/`results`). Value keys may be `kwh`, `value`, `total`,
`energy` or `production`.

## 2. Install the integration

Copy `custom_components/solar_dashboard/` into your HA config folder, restart
HA, then Settings > Devices & services > Add integration > **Solar Dashboard**.
Enter the endpoint URL (e.g. `http://192.168.1.50:5001/solar/daily`), an
optional bearer token, and the refresh interval (default 5 min).

## 3. Add the card

The card JS is registered automatically. If the card shows as "custom element
doesn't exist" on your HA, add it manually: Settings > Dashboards > Resources >
Add resource:

```
URL:  /solar_dashboard_static/solar-dashboard-card.js
Type: JavaScript module
```

Then hard-refresh the browser and add a manual card:

```yaml
type: custom:solar-dashboard-card
```

### Card options

| Option | Default | Notes |
|---|---|---|
| `view` | `all` | `all`, `period` (week/month toggle), `daily` (daily by month with month picker), `yearly` (monthly totals by year) |
| `title` | `Solar Dashboard` | set to `""` to hide the header |
| `color` | `#4fc3f7` | bar colour for week/month/daily charts |
| `year_colors` | blue, orange, green, purple, red | list of colours, oldest year first |
| `years` | `3` | how many most recent years to compare |
| `chart_height` | `220` | pixels per chart |
| `compact` | `false` | caps chart height at 150 |
| `week_start` | `monday` | or `sunday` |
| `refresh_minutes` | `5` | how often the card re-requests data |
| `entry_id` | first entry | only needed with multiple instances |

To place charts separately (e.g. in a grid), use one card per `view`:

```yaml
type: custom:solar-dashboard-card
view: yearly
title: ""
```

Hover (or tap) a bar for its exact value.

## Sensors

The integration also creates energy sensors (kWh) usable in any card or
automation: Today, Yesterday, This week (Mon-based), This month, This year,
Lifetime, Average per day this month, and Best day (with a `date` attribute).
They update on each refresh and don't feed long-term statistics, since they
reset periodically.

## Notes

- Days with no row show no bar; zero-value days also show no bar.
- "Today" in the card uses the browser's clock; sensors use HA's time zone.
- Data refreshes only as often as the polling interval, so a new reading may
  take up to that long to appear. The refresh button in the card header forces
  an immediate fetch.
