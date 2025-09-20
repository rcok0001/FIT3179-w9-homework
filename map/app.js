// ---------- Config ----------
const BASE = window.MAP_BASE || ""; // main page sets this to "map/", standalone map page leaves it unset
const GEOJSON_PATH = BASE + "./data/states.geojson";
const CSV_PATH = BASE + "./data/values_clean.csv";

// 10-step orange, light→dark (no near-white)
const RAMP = [
  "#FFE0CC", "#FFCC99", "#FFB366", "#FF9933", "#FF851A",
  "#FF7300", "#F56500", "#D95C00", "#B24A00", "#803300"
];

const HOVER_DEFAULT = "Hover to see details";

// ---------- Map ----------
const map = L.map("map", { scrollWheelZoom: true, zoomControl: false })
  .setView([-25.3, 133.8], 4);
L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 7, minZoom: 3, attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// ---------- UI elements (inside iframe; mirrored to host) ----------
const hoverInfo = document.getElementById("hoverInfo");
const legendEl = document.getElementById("legend");
const metricSel = document.getElementById("metricSelect");
const totalInfoEl = document.getElementById("totalInfo");

hoverInfo.textContent = HOVER_DEFAULT;

let dataByState = {};   // { "New South Wales": { "Black coal": 45812.6, ... }, ... }
let metrics = [];       // ["Black coal","Brown coal","Natural gas",...]
let activeMetric = null;
let minVal = 0, maxVal = 1;
let geoLayer = null;

// ---------- Formatting ----------
const nf = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 });

function unitFor(metric) {
  return metric === "Per cent renewable generation" ? "%" : "GWh";
}

function formatValue(metric, v) {
  if (v === null || v === undefined || isNaN(v)) return "No data";
  const u = unitFor(metric);
  return `${nf.format(v)}\u00A0${u}`; // NBSP before unit
}

// ---------- CSV loader for wide format: state + many metric columns ----------
async function loadWideCSV(url) {
  const text = await fetch(url).then(r => r.text());
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV appears empty");

  const headers = lines[0].split(",").map(s => s.trim());
  const stateIdx = headers.indexOf("state");
  if (stateIdx === -1) throw new Error("CSV needs a 'state' column");

  // metric names = all headers except 'state'
  const metricNames = headers.filter((_, i) => i !== stateIdx);

  const table = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map(s => s.trim());
    if (!cells.length) continue;
    const state = cells[stateIdx];
    if (!state) continue;

    const row = {};
    metricNames.forEach((name, j) => {
      const idx = headers.indexOf(name);
      const raw = cells[idx];
      const v = raw === undefined || raw === "" ? NaN : Number(raw);
      row[name] = isNaN(v) ? null : v;
    });
    table[state] = row;
  }

  return { table, metricNames };
}

// ---------- Scaling & color ----------
function computeMinMax(data, metric) {
  const vals = Object.values(data).map(o => Number(o?.[metric])).filter(v => Number.isFinite(v));
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function colorFor(v) {
  if (!Number.isFinite(v)) return "#ddd";
  if (minVal === maxVal) return RAMP[RAMP.length - 1];
  const t = (v - minVal) / (maxVal - minVal);
  const idx = Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
  return RAMP[idx];
}

// ---------- Totals / Averages ----------
function computeSum(metric) {
  const vals = Object.values(dataByState)
    .map(o => Number(o?.[metric]))
    .filter(v => Number.isFinite(v));
  return vals.reduce((a, b) => a + b, 0);
}

function computeAverage(metric) {
  const vals = Object.values(dataByState)
    .map(o => Number(o?.[metric]))
    .filter(v => Number.isFinite(v));
  return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : NaN;
}

// ---------- Legend ----------
function buildLegend() {
  const gradient = `linear-gradient(to right, ${RAMP.join(",")})`;
  const unit = unitFor(activeMetric);

  // Compute Total or Average
  const isPercent = unit === "%";
  const value = isPercent ? computeAverage(activeMetric) : computeSum(activeMetric);
  const label = isPercent ? "Average" : "Total";
  const valueText = Number.isFinite(value)
    ? `${label}: ${formatValue(activeMetric, value)}`
    : `${label}: No data`;

  // Build legend HTML with a bold subheading above the bar
  legendEl.innerHTML = `
    <div style="font-weight:600;font-size:.95rem;">${activeMetric} (${unit})</div>
    <div style="font-size:.9rem;color:#374151;margin-bottom:4px;">${valueText}</div>
    <div style="font-weight:600;margin-top:6px;">Scale</div>
    <div class="bar" style="background:${gradient};
         height:12px;border-radius:6px;
         box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);"></div>
    <div class="axis" style="display:flex;justify-content:space-between;
         font-size:.85rem;color:#6b7280;">
      <span>${Number.isFinite(minVal) ? nf.format(minVal) : ""}</span>
      <span>${Number.isFinite(maxVal) ? nf.format(maxVal) : ""}</span>
    </div>
  `;

  // Clear the old separate total element if it exists
  if (totalInfoEl) totalInfoEl.textContent = "";
}



// ---------- Feature styling & events ----------
function styleFeature(feature) {
  const name = feature.properties.STATE_NAME || feature.properties.STATE || feature.properties.name;
  const v = Number(dataByState[name]?.[activeMetric]);
  return { color: "#555", weight: 1, fillOpacity: 0.85, fillColor: colorFor(v) };
}

function popupHTML(name, obj) {
  const rows = metrics.map(k => {
    const v = obj?.[k];
    return `<tr><td style="padding-right:8px">${k}</td><td><strong>${formatValue(k, Number(v))}</strong></td></tr>`;
  }).join("");
  return `<strong>${name}</strong><br><table>${rows}</table>`;
}

function onEachFeature(feature, lyr) {
  const name = feature.properties.STATE_NAME || feature.properties.STATE || feature.properties.name;
  const obj = dataByState[name];
  lyr.bindPopup(popupHTML(name, obj));

  lyr.on({
    mouseover: e => {
      const t = e.target;
      t.setStyle({ weight: 3, color: "#000" });
      if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) t.bringToFront();
      const v = obj?.[activeMetric];
      const valText = formatValue(activeMetric, Number(v));
      hoverInfo.innerHTML = `<strong>${name}</strong><br>${activeMetric}: <strong>${valText}</strong>`;
      t.openPopup();
    },
    mouseout: e => {
      geoLayer.resetStyle(e.target);
      hoverInfo.textContent = HOVER_DEFAULT;
      e.target.closePopup();
    },
    click: e => e.target.openPopup()
  });
}

// ---------- Render / rerender ----------
function renderLayer(geojson) {
  if (geoLayer) map.removeLayer(geoLayer);
  geoLayer = L.geoJSON(geojson, { style: styleFeature, onEachFeature }).addTo(map);
}

function recomputeAndRedraw(geojson) {
  const mm = computeMinMax(dataByState, activeMetric);
  minVal = mm.min; maxVal = mm.max;
  buildLegend();
  renderLayer(geojson);
}

// ---------- Init ----------
async function init() {
  // 1) Load data
  const { table, metricNames } = await loadWideCSV(CSV_PATH);
  dataByState = table;
  metrics = metricNames;

  // 2) Build dropdown
  metricSel.innerHTML = metrics.map(m => `<option value="${m}">${m}</option>`).join("");
  activeMetric = metrics.includes("Total renewable") ? "Total renewable" : metrics[0];

  // 3) Load boundaries
  const geojson = await fetch(GEOJSON_PATH).then(r => r.json());

  // 4) Initial render
  metricSel.value = activeMetric;
  recomputeAndRedraw(geojson);

  // 5) React to metric changes
  metricSel.addEventListener("change", () => {
    activeMetric = metricSel.value;
    recomputeAndRedraw(geojson);
  });
}

init().catch(err => {
  console.error(err);
  alert("Failed to load data or GeoJSON. Check console for details.");
});
