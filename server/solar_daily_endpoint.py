"""
Read-only endpoint that returns daily solar totals as JSON for the
Solar Dashboard integration.

GET /solar/daily  ->  [{"date": "2026-10-01", "kwh": 31.2}, ...]

This is a standalone Flask example. If your existing receiver already runs a
web framework, copy the query and route into it instead of running a second
server. Edit the constants below to match your solar_data.db schema.

    pip install flask
    python3 solar_daily_endpoint.py
"""
import sqlite3

from flask import Flask, abort, jsonify, request

DB_PATH = "/path/to/solar_data.db"
TABLE = "solar_daily"   # <- your table name
DATE_COL = "date"       # <- column holding YYYY-MM-DD
KWH_COL = "kwh"         # <- column holding the day's kWh total
TOKEN = ""              # optional: set a string and enter it in the HA setup form
PORT = 5001

app = Flask(__name__)


@app.get("/solar/daily")
def daily():
    if TOKEN and request.headers.get("Authorization") != f"Bearer {TOKEN}":
        abort(401)

    # MAX() guards against more than one row per date (e.g. running totals).
    query = (
        f"SELECT substr({DATE_COL}, 1, 10) AS d, MAX({KWH_COL}) AS kwh "
        f"FROM {TABLE} GROUP BY d ORDER BY d"
    )
    with sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True) as con:
        rows = con.execute(query).fetchall()
    return jsonify([{"date": d, "kwh": k} for d, k in rows if k is not None])


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
