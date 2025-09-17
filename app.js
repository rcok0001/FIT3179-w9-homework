// ---------- Config ----------
const VALUE_LABEL = "Example Value";          // Shown in legend & tooltips
const GEOJSON_PATH = "./data/states.geojson"; // Local file
const CSV_PATH = "./data/values.csv";         // Use CSV by default
const JSON_PATH = "./data/values.json";       // Or switch to JSON if you prefer

// 7-step color ramp (light → dark). Adjust to taste.
const RAMP = ["#f7fbff","#deebf7","#c6dbef","#9ecae1","#6baed6","#3182bd","#08519c"];

// ---------- Map bootstrap ----------
const map = L.map("map", { scrollWheelZoom: true }).setView([-25.3, 133.8], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 7, minZoom: 3, attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const hoverInfo = document.getElementById("hoverInfo");
const legendEl = document.getElementById("legend");

// ---------- Data loading ----------
async function loadCSV(url) {
  const text = await fetch(url).then(r => r.text());
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const [colState, colValue] = header.split(",");
  const out = {};
  rows.forEach(line => {
    const [state, value] = line.split(",");
    out[state.trim()] = Number(value);
  });
  return out;
}

async function loadJSON(url) {
  // Expect shape: [{ "state": "Victoria", "value": 55 }, ...]
  const arr = await fetch(url).then(r => r.json());
  const out = {};
  for (const { state, value } of arr) out[state] = Number(value);
  return out;
}

async function loadData() {
  // Choose one loader:
  // return await loadJSON(JSON_PATH);
  return await loadCSV(CSV_PATH);
}

// ---------- Color scaling ----------
function computeMinMax(obj) {
  const vals = Object.values(obj).filter(v => !isNaN(v));
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function colorFor(v, min, max) {
  if (isNaN(v)) return "#ddd";
  if (min === max) return RAMP[RAMP.length - 1];
  const t = (v - min) / (max - min);
  const idx = Math.min(RAMP.length - 1, Math.floor(t * RAMP.length));
  return RAMP[idx];
}

// ---------- Legend ----------
function buildLegend(min, max) {
  const steps = RAMP.length;
  const interval = (max - min) / steps;

  let html = `<div><strong>${VALUE_LABEL}</strong></div>`;
  html += '<div class="scale">';
  for (let i = 0; i < steps; i++) {
    const swatch = RAMP[i];
    const v0 = min + i * interval;
    const v1 = i === steps - 1 ? max : min + (i + 1) * interval;
    html += `<div class="swatch" style="background:${swatch}" title="${v0.toFixed(2)}–${v1.toFixed(2)}"></div>`;
  }
  html += "</div>";
  html += `<div style="margin-top:6px; font-size:12px">Min: ${min} | Max: ${max}</div>`;
  legendEl.innerHTML = html;
}

// ---------- Render ----------
async function init() {
  const data = await loadData(); // { "Victoria": 55, ... }
  const { min, max } = computeMinMax(data);

  const geojson = await fetch(GEOJSON_PATH).then(r => r.json());

  const layer = L.geoJSON(geojson, {
    style: feature => {
      const name = feature.properties.STATE_NAME || feature.properties.STATE || feature.properties.name;
      const v = data[name];
      return { color: "#555", weight: 1, fillOpacity: 0.85, fillColor: colorFor(v, min, max) };
    },
    onEachFeature: (feature, lyr) => {
      const name = feature.properties.STATE_NAME || feature.properties.STATE || feature.properties.name;
      const v = data[name];
      const valText = (v !== undefined) ? v : "No data";
      lyr.bindPopup(`<strong>${name}</strong><br>${VALUE_LABEL}: <strong>${valText}</strong>`);

      lyr.on({
        mouseover: e => {
          const t = e.target;
          t.setStyle({ weight: 3, color: "#000" });
          if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) t.bringToFront();
          hoverInfo.innerHTML = `<strong>${name}</strong><br>${VALUE_LABEL}: <strong>${valText}</strong>`;
        },
        mouseout: e => {
          layer.resetStyle(e.target);
          hoverInfo.textContent = "Hover a state/territory";
        },
        click: e => e.target.openPopup()
      });
    }
  }).addTo(map);

  map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  buildLegend(min, max);
}

init().catch(err => {
  console.error(err);
  alert("Failed to load data or GeoJSON. Check console for details.");
});
