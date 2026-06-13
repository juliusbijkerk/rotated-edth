import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createMap, renderPOIs, unitMarker, drawAO, UNIT_COLORS, Preset } from './map';
import { connect } from './ws';

const mapEl = document.getElementById('map')!;
const presetSelect = document.getElementById('preset-select') as HTMLSelectElement;
const unitList = document.getElementById('unit-list')!;
const transcriptLog = document.getElementById('transcript-log')!;
const aoTitleEl = document.getElementById('ao-title')!;

let map: L.Map | null = null;
let poiLayer: L.LayerGroup | null = null;
let aoLayer: L.LayerGroup | null = null;
const trailsLayer: L.LayerGroup = L.layerGroup();
const unitMarkers: Record<string, L.Marker> = {};
const unitTrails: Record<string, L.Polyline> = {};
let currentPreset: Preset | null = null;

const ws = connect('/ws/operator');

void mapEl;

async function fetchPresets() {
  const r = await fetch('/api/presets');
  const presets: { id: string; name: string }[] = await r.json();
  presetSelect.innerHTML = '';
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    presetSelect.appendChild(opt);
  }
  if (presets.length) {
    await loadPreset(presets[0].id);
  }
}

async function loadPreset(id: string) {
  const r = await fetch(`/api/presets/${id}`);
  const preset: Preset = await r.json();
  currentPreset = preset;
  aoTitleEl.textContent = `${preset.name} · ${preset.pois.length} POIs`;
  const [lon, lat] = preset.center;
  if (!map) {
    map = createMap('map', [lat, lon], preset.zoom);
    trailsLayer.addTo(map);
  }
  // Frame the whole AO so its dashed border + dimmed surroundings are visible (clear focus area).
  map.fitBounds([[preset.bbox[1], preset.bbox[0]], [preset.bbox[3], preset.bbox[2]]], { padding: [30, 30] });
  if (poiLayer) poiLayer.remove();
  poiLayer = renderPOIs(map, preset.pois);
  if (aoLayer) aoLayer.remove();
  aoLayer = drawAO(map, preset.bbox);
  ws.send({ type: 'set_ao', ao_id: id });
}

presetSelect.addEventListener('change', () => {
  loadPreset(presetSelect.value);
});

ws.onMessage((msg) => {
  if (typeof msg !== 'object' || msg === null) return;
  const m = msg as any;
  if (m.type === 'state') {
    if (m.units) renderUnits(m.units);
    if (m.reports) {
      transcriptLog.innerHTML = '';
      // Show oldest at bottom; newest on top — prepend each in stored order.
      for (const r of m.reports) addReport(r);
      if (m.reports.length) focusOnReport(m.reports[m.reports.length - 1]);
    }
  } else if (m.type === 'report') {
    addReport(m.report);
    if (m.units) renderUnits(m.units);
    focusOnReport(m.report);  // glide the map to the new fix so it's never off-screen
  } else if (m.type === 'ao_changed') {
    if (m.ao_id && m.ao_id !== currentPreset?.id) {
      presetSelect.value = m.ao_id;
      loadPreset(m.ao_id);
    }
  } else if (m.type === 'error') {
    addErrorCard(m);
  }
});

function renderUnits(units: Record<string, any>) {
  if (!map) return;
  unitList.innerHTML = '';
  for (const [uid, u] of Object.entries(units)) {
    const lp = u.last_position;
    const li = document.createElement('div');
    li.className = 'unit-row';
    li.innerHTML = `<span class="unit-name" style="color:${UNIT_COLORS[uid] ?? '#fff'}">${uid}</span>` +
      (lp ? `<span class="unit-coord">${lp.lat.toFixed(5)}, ${lp.lon.toFixed(5)}</span>`
          : `<span class="unit-coord stale">no fix</span>`);
    unitList.appendChild(li);

    if (lp) {
      const latlng: L.LatLngExpression = [lp.lat, lp.lon];
      if (unitMarkers[uid]) {
        unitMarkers[uid].setLatLng(latlng);
      } else {
        unitMarkers[uid] = unitMarker(uid, lp.lat, lp.lon).addTo(map);
      }
      const positions: L.LatLngExpression[] = (u.positions || []).map((p: any) => [p.lat, p.lon] as L.LatLngExpression);
      if (positions.length > 1) {
        if (unitTrails[uid]) {
          unitTrails[uid].setLatLngs(positions);
        } else {
          unitTrails[uid] = L.polyline(positions, {
            color: UNIT_COLORS[uid] ?? '#ffcc00',
            weight: 3,
            opacity: 0.7,
          }).addTo(trailsLayer);
        }
      }
    }
  }
}

function focusOnReport(report: any) {
  if (!map || !report) return;
  const r = report.resolved || {};
  if (typeof r.lat === 'number' && typeof r.lon === 'number') {
    // flyTo keeps spatial context (animated) and guarantees the new marker is centered,
    // never stranded off-screen — the operator should never have to hunt for the latest fix.
    map.flyTo([r.lat, r.lon], Math.max(map.getZoom(), 16), { duration: 0.8 });
  }
}

function addReport(report: any) {
  const card = document.createElement('div');
  card.className = 'report-card';
  card.style.borderLeftColor = UNIT_COLORS[report.unit] ?? '#3ee47a';
  const resolved = report.resolved || {};
  const needs = resolved.needs_review;
  const parsed = report.parsed || {};
  const action = parsed.action || '';
  card.innerHTML = `
    <div class="report-head">
      <span class="report-unit" style="color:${UNIT_COLORS[report.unit] ?? '#fff'}">${report.unit}${action ? ' · ' + escapeHtml(action) : ''}</span>
      <span class="report-method ${needs ? 'unresolved' : ''}">${escapeHtml(resolved.method || '?')}</span>
    </div>
    <div class="report-transcript">${escapeHtml(report.transcript || '')}</div>
    ${resolved.poi_name ? `<div class="report-poi">→ ${escapeHtml(resolved.poi_name)}</div>` : ''}
  `;
  transcriptLog.prepend(card);
}

function addErrorCard(err: any) {
  const card = document.createElement('div');
  card.className = 'report-card error';
  card.textContent = `[${err.stage}] ${err.error}`;
  transcriptLog.prepend(card);
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

fetchPresets();
