/*
 * solar-dashboard-card
 * Native Lovelace card for the Solar Dashboard integration.
 * Draws SVG charts from daily kWh totals fetched over HA's websocket,
 * so there is no iframe, no external server request and no mixed-content issue.
 *
 * type: custom:solar-dashboard-card
 * view: all | period | daily | yearly     (default: all)
 */

const SD_YEAR_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#9467bd", "#d62728"];

const sdEsc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sdPad = (n) => String(n).padStart(2, "0");
const sdYmd = (d) => `${d.getFullYear()}-${sdPad(d.getMonth() + 1)}-${sdPad(d.getDate())}`;
const sdAddDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sdFmt = (v, dec = 1) => v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });

class SolarDashboardCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._mode = "week";
    this._month = null;
    this._data = new Map();
    this._error = null;
    this._started = false;
    this._w = 0;
  }

  setConfig(config) {
    this._config = Object.assign(
      {
        view: "all",
        title: "Solar Dashboard",
        color: "#4fc3f7",
        chart_height: 220,
        years: 3,
        week_start: "monday",
        refresh_minutes: 5,
        compact: false,
      },
      config || {}
    );
    if (this._config.compact) this._config.chart_height = Math.min(this._config.chart_height, 150);
    this._build();
  }

  getCardSize() {
    return this._config && this._config.view === "all" ? 12 : 4;
  }

  static getStubConfig() {
    return { view: "all" };
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started && this.isConnected) this._start();
  }

  connectedCallback() {
    this._ro = new ResizeObserver(() => {
      const w = this.clientWidth;
      if (w !== this._w) {
        this._w = w;
        this._draw();
      }
    });
    this._ro.observe(this);
    if (this._hass && !this._started) this._start();
  }

  disconnectedCallback() {
    if (this._ro) this._ro.disconnect();
    clearInterval(this._timer);
    this._started = false;
  }

  _start() {
    this._started = true;
    this._load(false);
    clearInterval(this._timer);
    this._timer = setInterval(() => this._load(false), Math.max(1, this._config.refresh_minutes) * 60000);
  }

  async _load(force) {
    try {
      const res = await this._hass.callWS({
        type: "solar_dashboard/data",
        entry_id: this._config.entry_id,
        refresh: !!force,
      });
      this._data = new Map(res.days);
      this._error = null;
    } catch (e) {
      this._error = (e && e.message) || "Failed to load solar data";
    }
    this._updateControls();
    this._draw();
  }

  /* ---------- skeleton ---------- */

  _build() {
    const c = this._config;
    const v = c.view;
    const show = (s) => v === "all" || v === s;
    const lang = (this._hass && this._hass.locale && this._hass.locale.language) || undefined;
    this._lang = lang;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px 16px 16px; position: relative; }
        .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        h2 { margin: 0; font-size: 1.3em; font-weight: 500; color: var(--primary-text-color); }
        h3 { margin: 0; font-size: 1.05em; font-weight: 500; color: var(--primary-text-color); }
        section { margin-top: 14px; }
        .sh { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .sum { font-size: 0.85em; color: var(--secondary-text-color); margin: 2px 0 4px; min-height: 1.2em; }
        button, select {
          font: inherit; font-size: 0.85em; padding: 3px 10px; border-radius: 6px; cursor: pointer;
          border: 1px solid var(--divider-color); background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        button:hover { border-color: var(--sd-color); }
        .chart { width: 100%; }
        svg { display: block; }
        .grid { stroke: var(--divider-color); stroke-width: 1; }
        .ax { fill: var(--secondary-text-color); font-size: 10px; }
        .vl { fill: var(--primary-text-color); font-size: 10px; }
        .avg { stroke: var(--secondary-text-color); stroke-width: 1; stroke-dasharray: 4 3; }
        .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.8em; color: var(--secondary-text-color); margin-top: 4px; }
        .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }
        .err { color: var(--error-color); font-size: 0.9em; padding: 8px 0; }
        .empty { color: var(--secondary-text-color); font-size: 0.9em; padding: 24px 0; text-align: center; }
        .tip {
          position: absolute; pointer-events: none; display: none; z-index: 2; white-space: nowrap;
          background: var(--primary-text-color); color: var(--card-background-color);
          font-size: 0.75em; padding: 3px 7px; border-radius: 4px;
        }
      </style>
      <ha-card style="--sd-color:${sdEsc(c.color)}">
        ${
          c.title
            ? `<div class="head"><h2>${sdEsc(c.title)}</h2><button id="refresh" title="Refresh">&#8635;</button></div>`
            : ""
        }
        <div id="err" class="err" hidden></div>
        ${
          show("period")
            ? `<section data-s="period">
                 <div class="sh"><h3 id="period-title">This week</h3><button id="toggle">Month</button></div>
                 <div class="sum" id="period-sum"></div><div class="chart" id="period-chart"></div>
               </section>`
            : ""
        }
        ${
          show("daily")
            ? `<section data-s="daily">
                 <div class="sh"><h3>Daily production</h3><select id="month"></select></div>
                 <div class="sum" id="daily-sum"></div><div class="chart" id="daily-chart"></div>
               </section>`
            : ""
        }
        ${
          show("yearly")
            ? `<section data-s="yearly">
                 <div class="sh"><h3>Monthly totals by year</h3></div>
                 <div class="sum" id="yearly-sum"></div><div class="chart" id="yearly-chart"></div>
                 <div class="legend" id="yearly-legend"></div>
               </section>`
            : ""
        }
        <div class="tip" id="tip"></div>
      </ha-card>`;

    const $ = (id) => this.shadowRoot.getElementById(id);
    const card = this.shadowRoot.querySelector("ha-card");
    const tip = $("tip");

    if ($("refresh")) $("refresh").onclick = () => this._load(true);
    if ($("toggle"))
      $("toggle").onclick = () => {
        this._mode = this._mode === "week" ? "month" : "week";
        this._draw();
      };
    if ($("month"))
      $("month").onchange = (e) => {
        this._month = e.target.value;
        this._draw();
      };

    const showTip = (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t) {
        tip.style.display = "none";
        return;
      }
      tip.textContent = t.getAttribute("data-tip");
      tip.style.display = "block";
      const r = card.getBoundingClientRect();
      const tw = tip.offsetWidth;
      let left = e.clientX - r.left - tw / 2;
      left = Math.max(4, Math.min(left, r.width - tw - 4));
      tip.style.left = `${left}px`;
      tip.style.top = `${e.clientY - r.top - 32}px`;
    };
    card.addEventListener("pointermove", showTip);
    card.addEventListener("pointerdown", showTip);
    card.addEventListener("pointerleave", () => (tip.style.display = "none"));
  }

  _monthKeys() {
    const set = new Set();
    this._data.forEach((_, k) => set.add(k.slice(0, 7)));
    const now = new Date();
    set.add(`${now.getFullYear()}-${sdPad(now.getMonth() + 1)}`);
    return [...set].sort().reverse();
  }

  _updateControls() {
    const sel = this.shadowRoot.getElementById("month");
    if (!sel) return;
    const keys = this._monthKeys();
    if (!this._month || !keys.includes(this._month)) this._month = keys[0];
    sel.innerHTML = keys.map((k) => `<option value="${k}" ${k === this._month ? "selected" : ""}>${k}</option>`).join("");
  }

  /* ---------- drawing ---------- */

  _chartWidth(id) {
    const el = this.shadowRoot.getElementById(id);
    return (el && el.clientWidth) || this.clientWidth - 32 || 340;
  }

  _set(id, html) {
    const el = this.shadowRoot.getElementById(id);
    if (el) el.innerHTML = html;
  }

  _draw() {
    if (!this.shadowRoot.querySelector("ha-card")) return;
    const errEl = this.shadowRoot.getElementById("err");
    if (errEl) {
      errEl.hidden = !this._error;
      errEl.textContent = this._error || "";
    }
    if (this._data.size === 0 && !this._error && !this._started) return;
    if (this._data.size === 0) {
      ["period-chart", "daily-chart", "yearly-chart"].forEach((id) =>
        this._set(id, this._error ? "" : `<div class="empty">No data yet</div>`)
      );
      return;
    }
    this._drawPeriod();
    this._drawDaily();
    this._drawYearly();
  }

  _drawPeriod() {
    if (!this.shadowRoot.getElementById("period-chart")) return;
    const c = this._config;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const labels = [];
    const values = [];
    let heading;

    if (this._mode === "week") {
      const first = c.week_start === "sunday" ? 0 : 1;
      const start = sdAddDays(today, -((today.getDay() - first + 7) % 7));
      for (let i = 0; i < 7; i++) {
        const d = sdAddDays(start, i);
        labels.push(d.toLocaleDateString(this._lang, { weekday: "short" }));
        values.push(d > today ? null : this._data.has(sdYmd(d)) ? this._data.get(sdYmd(d)) : null);
      }
      heading = "This week";
    } else {
      const y = today.getFullYear();
      const m = today.getMonth();
      const n = new Date(y, m + 1, 0).getDate();
      for (let i = 1; i <= n; i++) {
        const d = new Date(y, m, i);
        labels.push(String(i));
        values.push(d > today ? null : this._data.has(sdYmd(d)) ? this._data.get(sdYmd(d)) : null);
      }
      heading = "This month";
    }

    const total = values.reduce((a, v) => a + (v || 0), 0);
    this._set("period-title", heading);
    const toggle = this.shadowRoot.getElementById("toggle");
    if (toggle) toggle.textContent = this._mode === "week" ? "Month" : "Week";
    this._set("period-sum", `Total ${sdFmt(total)} kWh`);
    this._set(
      "period-chart",
      this._bars({
        labels,
        series: [{ name: "Production", color: c.color, values }],
        width: this._chartWidth("period-chart"),
        height: c.chart_height,
        valueLabels: this._mode === "week",
        labelW: this._mode === "week" ? 34 : 18,
      })
    );
  }

  _drawDaily() {
    if (!this.shadowRoot.getElementById("daily-chart")) return;
    const c = this._config;
    const [y, m] = this._month.split("-").map(Number);
    const n = new Date(y, m, 0).getDate();
    const labels = [];
    const values = [];
    for (let i = 1; i <= n; i++) {
      labels.push(String(i));
      const k = `${y}-${sdPad(m)}-${sdPad(i)}`;
      values.push(this._data.has(k) ? this._data.get(k) : null);
    }
    const have = values.filter((v) => v !== null);
    const total = have.reduce((a, v) => a + v, 0);
    const avg = have.length ? total / have.length : null;
    this._set(
      "daily-sum",
      have.length ? `Total ${sdFmt(total)} kWh · average ${sdFmt(avg)} kWh/day` : "No data for this month"
    );
    this._set(
      "daily-chart",
      this._bars({
        labels,
        series: [{ name: "Production", color: c.color, values }],
        width: this._chartWidth("daily-chart"),
        height: c.chart_height,
        avg,
        labelW: 18,
      })
    );
  }

  _drawYearly() {
    if (!this.shadowRoot.getElementById("yearly-chart")) return;
    const c = this._config;
    const years = new Set();
    this._data.forEach((_, k) => years.add(Number(k.slice(0, 4))));
    const list = [...years].sort().slice(-Math.max(1, c.years));
    const palette = c.year_colors || SD_YEAR_COLORS;
    const labels = Array.from({ length: 12 }, (_, i) =>
      new Date(2000, i, 1).toLocaleDateString(this._lang, { month: "short" })
    );

    const series = list.map((yr, idx) => {
      const sums = new Array(12).fill(null);
      this._data.forEach((v, k) => {
        if (Number(k.slice(0, 4)) !== yr) return;
        const mi = Number(k.slice(5, 7)) - 1;
        sums[mi] = (sums[mi] || 0) + v;
      });
      // Oldest year first in palette order, like the original dashboard.
      return { name: String(yr), color: palette[idx % palette.length], values: sums };
    });

    this._set("yearly-sum", "");
    this._set(
      "yearly-chart",
      this._bars({
        labels,
        series,
        width: this._chartWidth("yearly-chart"),
        height: c.chart_height,
        decimals: 0,
        labelW: 28,
      })
    );
    this._set(
      "yearly-legend",
      series
        .map((s) => {
          const tot = s.values.reduce((a, v) => a + (v || 0), 0);
          return `<span><i style="background:${s.color}"></i>${sdEsc(s.name)} · ${sdFmt(tot, 0)} kWh</span>`;
        })
        .join("")
    );
  }

  /* ---------- SVG bar chart ---------- */

  _scale(max) {
    if (max <= 0) return { top: 4, step: 1 };
    const raw = max / 4;
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / exp;
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    const step = nf * exp;
    return { top: Math.ceil(max / step - 1e-9) * step, step };
  }

  _bars({ labels, series, width, height, valueLabels = false, avg = null, labelW = 26, decimals = 1 }) {
    const m = { l: 40, r: 8, t: 16, b: 22 };
    const pw = Math.max(40, width - m.l - m.r);
    const ph = height - m.t - m.b;

    let max = 0;
    series.forEach((s) => s.values.forEach((v) => v != null && v > max && (max = v)));
    if (avg != null && avg > max) max = avg;
    const { top, step } = this._scale(max);

    const n = labels.length;
    const ns = series.length;
    const gw = pw / n;
    const bw = Math.max(1, (gw * 0.78) / ns);
    const off = (gw - bw * ns) / 2;

    let out = "";
    const ticks = Math.round(top / step);
    for (let i = 0; i <= ticks; i++) {
      const v = i * step;
      const y = m.t + ph - (v / top) * ph;
      const txt = Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v).toLocaleString() : v.toFixed(1);
      out += `<line class="grid" x1="${m.l}" x2="${width - m.r}" y1="${y}" y2="${y}"/>`;
      out += `<text class="ax" x="${m.l - 6}" y="${y + 3}" text-anchor="end">${txt}</text>`;
    }

    const xs = Math.max(1, Math.ceil((labelW * n) / pw));
    labels.forEach((lab, i) => {
      if (i % xs !== 0) return;
      out += `<text class="ax" x="${m.l + i * gw + gw / 2}" y="${height - 6}" text-anchor="middle">${sdEsc(lab)}</text>`;
    });

    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        if (v == null || v <= 0) return;
        const h = Math.max(1, (v / top) * ph);
        const x = m.l + i * gw + off + si * bw;
        const y = m.t + ph - h;
        const tip = `${labels[i]}${ns > 1 ? " · " + s.name : ""}: ${sdFmt(v, decimals)} kWh`;
        out += `<rect x="${x}" y="${y}" width="${Math.max(1, bw - (ns > 1 ? 1 : 0))}" height="${h}" rx="2" style="fill:${s.color}" data-tip="${sdEsc(tip)}"/>`;
        if (valueLabels && bw >= 26) {
          out += `<text class="vl" x="${x + bw / 2}" y="${y - 3}" text-anchor="middle">${sdFmt(v, decimals)}</text>`;
        }
      });
    });

    if (avg != null) {
      const y = m.t + ph - (avg / top) * ph;
      out += `<line class="avg" x1="${m.l}" x2="${width - m.r}" y1="${y}" y2="${y}"/>`;
      out += `<text class="ax" x="${width - m.r}" y="${y - 3}" text-anchor="end">avg ${sdFmt(avg)}</text>`;
    }

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${out}</svg>`;
  }
}

if (!customElements.get("solar-dashboard-card")) {
  customElements.define("solar-dashboard-card", SolarDashboardCard);
}
window.customCards = window.customCards || [];
window.customCards.push({
  type: "solar-dashboard-card",
  name: "Solar Dashboard",
  description: "Week/month, daily-by-month and monthly-by-year solar production charts.",
});
