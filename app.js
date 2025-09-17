// ---------- Config ----------
const GEOJSON_PATH = "./data/states.geojson";
const CSV_PATH = "./data/values_clean.csv"; // <= use the cleaned CSV I linked

// 10-step orange, light→dark (no near-white)
const RAMP = [
  "#FFE0CC", "#FFCC99", "#FFB366", "#FF9933", "#FF851A",
  "#FF7300", "#F56500", "#D95C00", "#B24A00", "#803300"
];

const HOVER_DEFAULT = "Hover to see details"; // <- change this to whatever you like



const map = L.map("map", { scrollWheelZoom: true, zoomControl: false })
  .setView([-25.3, 133.8], 4);
L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 7, minZoom: 3, attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const hoverInfo = document.getElementById("hoverInfo");
const legendEl = document.getElementById("legend");
const metricSel = document.getElementById("metricSelect");

hoverInfo.textContent = HOVER_DEFAULT;

let dataByState = {};   // { "New South Wales": { "Black coal": 45812.6, ... }, ... }
let metrics = [];       // ["Black coal","Brown coal","Natural gas",...]
let activeMetric = null;
let minVal = 0, maxVal = 1;
let geoLayer = null;



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
  const vals = Object.values(data).map(o => Number(o?.[metric])).filter(v => !isNaN(v));
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function colorFor(v) {
  if (isNaN(v)) return "#ddd";
  if (minVal === maxVal) return RAMP[RAMP.length - 1];
  const t = (v - minVal) / (maxVal - minVal);
  const idx = Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
  return RAMP[idx];
}

// ---------- Legend ----------
function buildLegend(label) {
  const gradient = `linear-gradient(to right, ${RAMP.join(",")})`;
  const unit = metricLabel(activeMetric);   // <-- was metricUnit

  legendEl.innerHTML = `
    <div><strong>${label} (${unit})</strong></div>
    <div class="bar" style="background: ${gradient}"></div>
    <div class="axis">
      <span>${Number.isFinite(minVal) ? minVal.toFixed(0) : ""}</span>
      <span>${Number.isFinite(maxVal) ? maxVal.toFixed(0) : ""}</span>
    </div>
  `;
}


// ---------- Feature styling & events ----------
function metricLabel(metric) {
  // Everything except "Per cent renewable generation" is GWh in this dataset
  return metric === "Per cent renewable generation" ? "%" : "GWh";
}

function styleFeature(feature) {
  const name = feature.properties.STATE_NAME || feature.properties.STATE || feature.properties.name;
  const v = Number(dataByState[name]?.[activeMetric]);
  return { color: "#555", weight: 1, fillOpacity: 0.85, fillColor: colorFor(v) };
}

function popupHTML(name, obj) {
  const rows = metrics.map(k => {
    const v = obj?.[k];
    const unit = metricLabel(k);
    const val = (v === null || v === undefined || isNaN(v)) ? "No data" : `${v} ${unit}`;
    return `<tr><td style="padding-right:8px">${k}</td><td><strong>${val}</strong></td></tr>`;
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
      const valText = (v === null || v === undefined || isNaN(v)) ? "No data" : `${v} ${metricLabel(activeMetric)}`;
      hoverInfo.innerHTML = `<strong>${name}</strong><br>${activeMetric}: <strong>${valText}</strong>`;
      t.openPopup(); // hover tooltip-like behavior
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
  buildLegend(`${activeMetric} (${metricLabel(activeMetric)})`);
  renderLayer(geojson);
}

// ---------- Init ----------
async function init() {
  // 1) Load data
  const { table, metricNames } = await loadWideCSV(CSV_PATH);
  dataByState = table;
  // Optional: if you want to hide some metrics from the dropdown, filter here
  metrics = metricNames;

  // 2) Build dropdown
  metricSel.innerHTML = metrics.map(m => `<option value="${m}">${m}</option>`).join("");
  // Choose a sensible default if present
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
