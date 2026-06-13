import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  createMap, operatorMarker, renderPOIs, targetMarker,
  unitMarker, UNIT_COLORS, Preset, Target,
} from './map';
import { connect } from './ws';

const mapEl = document.getElementById('map')!;
const presetSelect = document.getElementById('preset-select') as HTMLSelectElement;
const unitList = document.getElementById('unit-list')!;
const targetList = document.getElementById('target-list')!;
const transcriptLog = document.getElementById('transcript-log')!;
const aoTitleEl = document.getElementById('ao-title')!;
const locateOperatorBtn = document.getElementById('locate-operator') as HTMLButtonElement;
const followReportsBtn = document.getElementById('follow-reports') as HTMLButtonElement;
const togglePoiBtn = document.getElementById('toggle-poi') as HTMLButtonElement;
const mapAction = document.getElementById('map-action') as HTMLSelectElement;
const manualUnit = document.getElementById('manual-unit') as HTMLSelectElement;
const manualAffiliation = document.getElementById('manual-affiliation') as HTMLSelectElement;
const manualEntity = document.getElementById('manual-entity') as HTMLSelectElement;
const operatorStatus = document.getElementById('operator-status')!;

let map: L.Map | null = null;
let poiLayer: L.LayerGroup | null = null;
const trailsLayer: L.LayerGroup = L.layerGroup();
const targetLayer: L.LayerGroup = L.layerGroup();
const unitMarkers: Record<string, L.Marker> = {};
const unitTrails: Record<string, L.Polyline> = {};
const targetMarkers: Record<string, L.Marker> = {};
let operatorPin: L.Marker | null = null;
let currentPreset: Preset | null = null;
let latestUnits: Record<string, any> = {};
let latestTargets: Target[] = [];
let showPoiLabels = false;
let followReports = true;

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
    targetLayer.addTo(map);
    map.on('click', handleMapClick);
  } else {
    map.setView([lat, lon], preset.zoom);
  }
  renderPresetPois();
  renderUnits(latestUnits);
  renderTargets(latestTargets);
  ws.send({ type: 'set_ao', ao_id: id });
}

presetSelect.addEventListener('change', () => {
  loadPreset(presetSelect.value);
});

ws.onMessage((msg) => {
  if (typeof msg !== 'object' || msg === null) return;
  const m = msg as any;
  if (m.type === 'state') {
    if (m.units) {
      latestUnits = m.units;
      renderUnits(latestUnits);
    }
    if (m.targets) {
      latestTargets = m.targets;
      renderTargets(latestTargets);
    }
    if (m.reports) {
      transcriptLog.innerHTML = '';
      // Show oldest at bottom; newest on top — prepend each in stored order.
      for (const r of m.reports) addReport(r);
      if (!m.reports.length) addEmpty(transcriptLog, 'Waiting for unit reports');
    }
  } else if (m.type === 'report') {
    addReport(m.report);
    if (m.units) {
      latestUnits = m.units;
      renderUnits(latestUnits);
    }
    if (m.targets) {
      latestTargets = m.targets;
      renderTargets(latestTargets);
    }
    followReport(m.report);
  } else if (m.type === 'units') {
    if (m.units) {
      latestUnits = m.units;
      renderUnits(latestUnits);
    }
  } else if (m.type === 'target') {
    if (m.targets) {
      latestTargets = m.targets;
      renderTargets(latestTargets);
    }
  } else if (m.type === 'ao_changed') {
    if (m.ao_id && m.ao_id !== currentPreset?.id) {
      presetSelect.value = m.ao_id;
      loadPreset(m.ao_id);
    }
  } else if (m.type === 'error') {
    addErrorCard(m);
  }
});

function setOperatorStatus(msg: string) {
  operatorStatus.textContent = msg;
}

function syncFollowButton() {
  followReportsBtn.setAttribute('aria-pressed', String(followReports));
  followReportsBtn.classList.toggle('active', followReports);
}

function renderPresetPois() {
  if (!map || !currentPreset) return;
  if (poiLayer) poiLayer.remove();
  poiLayer = renderPOIs(map, currentPreset.pois, {
    maxCount: showPoiLabels ? 160 : 80,
    showLabels: showPoiLabels,
  });
  togglePoiBtn.setAttribute('aria-pressed', String(showPoiLabels));
  togglePoiBtn.classList.toggle('active', showPoiLabels);
}

function handleMapClick(e: L.LeafletMouseEvent) {
  const action = mapAction.value;
  if (action === 'set_unit') {
    const unitId = manualUnit.value;
    ws.send({
      type: 'set_unit_position',
      unit_id: unitId,
      lat: e.latlng.lat,
      lon: e.latlng.lng,
    });
    setOperatorStatus(`SET ${unitId} ${formatCoord(e.latlng.lat, e.latlng.lng)}`);
  } else if (action === 'manual_target') {
    const entity = manualEntity.value;
    ws.send({
      type: 'manual_target',
      affiliation: manualAffiliation.value,
      entity_type: entity,
      label: entity,
      lat: e.latlng.lat,
      lon: e.latlng.lng,
    });
    setOperatorStatus(`DROPPED ${manualAffiliation.value.toUpperCase()} ${entity.toUpperCase()}`);
  }
}

function locateOperator() {
  if (!map) return;
  if (!navigator.geolocation) {
    setOperatorStatus('GEOLOCATION UNAVAILABLE');
    return;
  }
  setOperatorStatus('LOCATING OPERATOR...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const latlng: L.LatLngExpression = [latitude, longitude];
      if (operatorPin) {
        operatorPin.setLatLng(latlng);
      } else {
        operatorPin = operatorMarker(latitude, longitude).addTo(map!);
      }
      operatorPin.bindPopup(`Operator<br>${formatCoord(latitude, longitude)}<br>Accuracy ${Math.round(accuracy)} m`);
      map!.setView(latlng, Math.max(map!.getZoom(), 16));
      setOperatorStatus(`OPERATOR ${formatCoord(latitude, longitude)}`);
    },
    (err) => setOperatorStatus(`LOCATION ERROR: ${err.message || err.code}`),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
  );
}

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
            dashArray: '6 6',
          }).addTo(trailsLayer);
        }
      }
    }
  }
}

function renderTargets(targets: Target[]) {
  if (!map) return;
  latestTargets = targets || [];
  const seen = new Set<string>();
  for (const target of latestTargets) {
    seen.add(target.id);
    if (targetMarkers[target.id]) {
      targetMarkers[target.id].setLatLng([target.lat, target.lon]);
    } else {
      targetMarkers[target.id] = targetMarker(target).addTo(targetLayer);
    }
  }
  for (const id of Object.keys(targetMarkers)) {
    if (!seen.has(id)) {
      targetMarkers[id].remove();
      delete targetMarkers[id];
    }
  }
  renderTargetList();
}

function renderTargetList() {
  targetList.innerHTML = '';
  if (!latestTargets.length) {
    addEmpty(targetList, 'No targets reported');
    return;
  }
  for (const t of latestTargets.slice().reverse()) {
    const row = document.createElement('button');
    row.className = `target-row target-row-${t.affiliation || 'unknown'}`;
    row.type = 'button';
    row.innerHTML =
      `<span class="target-row-main">${escapeHtml((t.label || t.entity_type || 'target').toUpperCase())}</span>` +
      `<span class="target-row-meta">${escapeHtml(t.affiliation || 'unknown')} · ${escapeHtml(t.source_unit || 'operator')}` +
      `${t.needs_review ? ' · REVIEW' : ''}</span>`;
    row.addEventListener('click', () => {
      map?.setView([t.lat, t.lon], Math.max(map?.getZoom() ?? 16, 16));
      targetMarkers[t.id]?.openPopup();
    });
    targetList.appendChild(row);
  }
}

function addReport(report: any) {
  transcriptLog.querySelector('.empty-state')?.remove();
  const card = document.createElement('div');
  card.className = 'report-card';
  card.style.borderLeftColor = UNIT_COLORS[report.unit] ?? '#3ee47a';
  const resolved = report.resolved || {};
  const needs = resolved.needs_review;
  const parsed = report.parsed || {};
  const action = parsed.action || '';
  const target = report.target || parsed.target;
  card.innerHTML = `
    <div class="report-head">
      <span class="report-unit" style="color:${UNIT_COLORS[report.unit] ?? '#fff'}">${report.unit}${action ? ' · ' + escapeHtml(action) : ''}</span>
      <span class="report-method ${needs ? 'unresolved' : ''}">${escapeHtml(resolved.method || '?')}</span>
    </div>
    <div class="report-transcript">${escapeHtml(report.transcript || '')}</div>
    ${resolved.poi_name ? `<div class="report-poi">→ ${escapeHtml(resolved.poi_name)}</div>` : ''}
    ${target ? `<div class="report-target">${escapeHtml((target.affiliation || 'unknown').toUpperCase())} · ${escapeHtml(target.label || target.entity_type || 'target')}</div>` : ''}
  `;
  transcriptLog.prepend(card);
}

function addErrorCard(err: any) {
  transcriptLog.querySelector('.empty-state')?.remove();
  const card = document.createElement('div');
  card.className = 'report-card error';
  card.textContent = `[${err.stage}] ${err.error}`;
  transcriptLog.prepend(card);
}

function followReport(report: any) {
  if (!followReports || !map) return;
  const target = report?.target;
  if (target?.lat !== undefined && target?.lon !== undefined) {
    map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 16), { duration: 0.6 });
    setOperatorStatus(`FOLLOW TARGET ${formatCoord(target.lat, target.lon)}`);
    return;
  }
  const resolved = report?.resolved || {};
  if (!resolved.needs_review && resolved.lat !== undefined && resolved.lon !== undefined) {
    map.flyTo([resolved.lat, resolved.lon], Math.max(map.getZoom(), 16), { duration: 0.6 });
    setOperatorStatus(`FOLLOW ${report.unit || 'UNIT'} ${formatCoord(resolved.lat, resolved.lon)}`);
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function addEmpty(container: Element, text: string) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = text;
  container.appendChild(empty);
}

function formatCoord(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

locateOperatorBtn.addEventListener('click', locateOperator);
syncFollowButton();
followReportsBtn.addEventListener('click', () => {
  followReports = !followReports;
  syncFollowButton();
  setOperatorStatus(followReports ? 'FOLLOW REPORTS ON' : 'FOLLOW REPORTS OFF');
});
togglePoiBtn.addEventListener('click', () => {
  showPoiLabels = !showPoiLabels;
  renderPresetPois();
  setOperatorStatus(showPoiLabels ? 'POI LABELS ON' : 'POI LABELS OFF');
});
fetchPresets();
