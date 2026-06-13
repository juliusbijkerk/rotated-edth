import {
  ArgusMap, ArgusMarker, BaseLayer, Preset, Target, UNIT_COLORS,
  createMap, markerPopup, operatorMarker, renderPOIs, renderUnitTrails,
  setThreeD, switchBaseLayer, targetMarker, unitMarker,
} from './map';
import { connect } from './ws';

const presetSelect = document.getElementById('preset-select') as HTMLSelectElement;
const unitList = document.getElementById('unit-list')!;
const targetList = document.getElementById('target-list')!;
const transcriptLog = document.getElementById('transcript-log')!;
const locateOperatorBtn = document.getElementById('locate-operator') as HTMLButtonElement;
const followReportsBtn = document.getElementById('follow-reports') as HTMLButtonElement;
const resetMissionBtn = document.getElementById('reset-mission') as HTMLButtonElement;
const togglePoiBtn = document.getElementById('toggle-poi') as HTMLButtonElement;
const toggle3dBtn = document.getElementById('toggle-3d') as HTMLButtonElement;
const mapAction = document.getElementById('map-action') as HTMLSelectElement;
const manualMapControls = document.getElementById('manual-map-controls')!;
const manualUnit = document.getElementById('manual-unit') as HTMLSelectElement;
const manualAffiliation = document.getElementById('manual-affiliation') as HTMLSelectElement;
const manualEntity = document.getElementById('manual-entity') as HTMLSelectElement;
const operatorStatus = document.getElementById('operator-status')!;
const operatorClock = document.getElementById('operator-clock')!;
const unitCountEl = document.getElementById('unit-count')!;
const targetCountEl = document.getElementById('target-count')!;
const reviewCountEl = document.getElementById('review-count')!;
const statFriendly = document.getElementById('stat-friendly')!;
const statHostile = document.getElementById('stat-hostile')!;
const statUnknown = document.getElementById('stat-unknown')!;
const statReview = document.getElementById('stat-review')!;
const statusAo = document.getElementById('status-ao')!;

let map: ArgusMap | null = null;
const unitMarkers: Record<string, ArgusMarker> = {};
const targetMarkers: Record<string, ArgusMarker> = {};
let operatorPin: ArgusMarker | null = null;
let currentPreset: Preset | null = null;
let latestUnits: Record<string, any> = {};
let latestTargets: Target[] = [];
let latestReports: any[] = [];
let showPoiLabels = false;
let followReports = true;
let targetFilter = 'all';
let baseLayer: BaseLayer = 'fusion';
let threeD = true;
const activePoiCategories = new Set(['critical', 'transport', 'power', 'military', 'telecom']);

const ws = connect('/ws/operator');

function sendOperator(msg: unknown) {
  if (ws.ws.readyState === WebSocket.OPEN) {
    ws.send(msg);
  } else {
    ws.onOpen(() => ws.send(msg));
  }
}

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
  statusAo.textContent = `${preset.name.toUpperCase()} · ${preset.pois.length} POIS`;
  const [lon, lat] = preset.center;
  if (!map) {
    map = createMap('map', [lat, lon], preset.zoom);
    map.on('style.load', () => {
      renderMapLayers();
      setThreeD(map!, threeD);
    });
    map.on('click', handleMapClick);
    map.on('load', () => {
      renderMapLayers();
      renderUnits(latestUnits);
      renderTargets(latestTargets);
    });
  } else {
    map.jumpTo({
      center: [lon, lat],
      zoom: preset.zoom,
      pitch: threeD ? 52 : 0,
      bearing: threeD ? 12 : 0,
    });
  }
  renderMapLayers();
  renderUnits(latestUnits);
  renderTargets(latestTargets);
  updateStats();
  sendOperator({ type: 'set_ao', ao_id: id });
}

presetSelect.addEventListener('change', () => {
  loadPreset(presetSelect.value);
});

ws.onMessage((msg) => {
  if (typeof msg !== 'object' || msg === null) return;
  const m = msg as any;
  if (m.type === 'state') {
    if (m.ao_id && currentPreset && m.ao_id !== currentPreset.id) {
      presetSelect.value = m.ao_id;
    }
    if (m.units) {
      latestUnits = m.units;
      renderUnits(latestUnits);
    }
    if (m.targets) {
      latestTargets = m.targets;
      renderTargets(latestTargets);
    }
    if (m.reports) {
      latestReports = m.reports;
      renderReports();
    }
  } else if (m.type === 'report') {
    upsertReport(m.report);
    if (m.units) {
      latestUnits = m.units;
      renderUnits(latestUnits);
    }
    if (m.targets) {
      latestTargets = m.targets;
      renderTargets(latestTargets);
    }
    followReport(m.report);
  } else if (m.type === 'report_reviewed') {
    upsertReport(m.report);
    if (m.units) {
      latestUnits = m.units;
      renderUnits(latestUnits);
    }
    if (m.targets) {
      latestTargets = m.targets;
      renderTargets(latestTargets);
    }
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

function renderMapLayers() {
  if (!map || !currentPreset || !map.isStyleLoaded()) return;
  renderPresetPois();
  renderUnitTrails(map, latestUnits);
}

function renderPresetPois() {
  if (!map || !currentPreset || !map.isStyleLoaded()) return;
  renderPOIs(map, currentPreset.pois, {
    maxCount: showPoiLabels ? 1800 : 900,
    showLabels: showPoiLabels,
    categories: activePoiCategories,
  });
  togglePoiBtn.setAttribute('aria-pressed', String(showPoiLabels));
  togglePoiBtn.classList.toggle('active', showPoiLabels);
}

function handleMapClick(e: any) {
  const action = mapAction.value;
  if (action === 'set_unit') {
    const unitId = manualUnit.value;
    sendOperator({
      type: 'set_unit_position',
      unit_id: unitId,
      lat: e.lngLat.lat,
      lon: e.lngLat.lng,
    });
    setOperatorStatus(`SET ${unitId} ${formatCoord(e.lngLat.lat, e.lngLat.lng)}`);
  } else if (action === 'manual_target') {
    const entity = manualEntity.value;
    sendOperator({
      type: 'manual_target',
      affiliation: manualAffiliation.value,
      entity_type: entity,
      label: entity,
      lat: e.lngLat.lat,
      lon: e.lngLat.lng,
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
      if (operatorPin) {
        operatorPin.setLngLat([longitude, latitude]);
      } else {
        operatorPin = operatorMarker(latitude, longitude).addTo(map!);
      }
      operatorPin.setPopup(markerPopup(
        `<div class="popup-content"><strong>Operator</strong><br>${formatCoord(latitude, longitude)}<br>Accuracy ${Math.round(accuracy)} m</div>`,
      ));
      map!.flyTo({ center: [longitude, latitude], zoom: Math.max(map!.getZoom(), 15), duration: 600 });
      setOperatorStatus(`OPERATOR ${formatCoord(latitude, longitude)}`);
    },
    (err) => setOperatorStatus(`LOCATION ERROR: ${err.message || err.code}`),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
  );
}

function renderUnits(units: Record<string, any>) {
  unitList.innerHTML = '';
  for (const [uid, u] of Object.entries(units)) {
    const lp = u.last_position;
    const li = document.createElement('div');
    li.className = 'unit-row';
    li.innerHTML = `<span class="unit-name" style="color:${UNIT_COLORS[uid] ?? '#fff'}">${uid}</span>` +
      (lp ? `<span class="unit-coord">${lp.lat.toFixed(5)}, ${lp.lon.toFixed(5)}</span>`
        : `<span class="unit-coord stale">no fix</span>`);
    unitList.appendChild(li);

    if (lp && map) {
      if (unitMarkers[uid]) {
        unitMarkers[uid].setLngLat([lp.lon, lp.lat]);
      } else {
        unitMarkers[uid] = unitMarker(uid, lp.lat, lp.lon).addTo(map);
      }
    } else if (unitMarkers[uid]) {
      unitMarkers[uid].remove();
      delete unitMarkers[uid];
    }
  }
  if (map?.isStyleLoaded()) renderUnitTrails(map, units);
  updateStats();
}

function renderTargets(targets: Target[]) {
  latestTargets = targets || [];
  const seen = new Set<string>();
  for (const target of latestTargets) {
    seen.add(target.id);
    if (targetMarkers[target.id]) {
      targetMarkers[target.id].setLngLat([target.lon, target.lat]);
    } else if (map) {
      targetMarkers[target.id] = targetMarker(target).addTo(map);
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
  const visibleTargets = latestTargets.filter((t) => targetFilter === 'all' || (t.affiliation || 'unknown') === targetFilter);
  if (!visibleTargets.length) {
    addEmpty(targetList, 'No targets reported');
    updateStats();
    return;
  }
  for (const t of visibleTargets.slice().reverse()) {
    const row = document.createElement('button');
    row.className = `target-row target-row-${t.affiliation || 'unknown'}`;
    row.type = 'button';
    row.innerHTML =
      `<span class="target-row-main">${escapeHtml((t.label || t.entity_type || 'target').toUpperCase())}</span>` +
      `<span class="target-row-meta">${escapeHtml(t.affiliation || 'unknown')} · ${escapeHtml(t.source_unit || 'operator')}` +
      `${t.needs_review ? ' · REVIEW' : ''}</span>`;
    row.addEventListener('click', () => {
      map?.flyTo({ center: [t.lon, t.lat], zoom: Math.max(map?.getZoom() ?? 15, 15), duration: 500 });
      targetMarkers[t.id]?.togglePopup();
    });
    targetList.appendChild(row);
  }
  updateStats();
}

function renderReports() {
  transcriptLog.innerHTML = '';
  if (!latestReports.length) {
    addEmpty(transcriptLog, 'Waiting for unit reports');
    updateStats();
    return;
  }
  for (const report of latestReports.slice().reverse()) {
    addReport(report);
  }
  updateStats();
}

function upsertReport(report: any) {
  const idx = latestReports.findIndex((r) => String(r.id) === String(report.id));
  if (idx >= 0) {
    latestReports[idx] = report;
  } else {
    latestReports.push(report);
  }
  renderReports();
}

function addReport(report: any) {
  const card = document.createElement('div');
  card.className = 'report-card';
  card.style.borderLeftColor = UNIT_COLORS[report.unit] ?? '#3ee47a';
  const resolved = report.resolved || {};
  const needs = resolved.needs_review;
  const parsed = report.parsed || {};
  const action = parsed.action || '';
  const displayTarget = report.target || parsed.target;
  const reviewStatus = report.review_status || '';
  const confidence = typeof parsed.confidence === 'number' ? `${Math.round(parsed.confidence * 100)}%` : '';
  const canReview = needs && !reviewStatus;
  const canAcceptPosition = canReview && action === 'position_update' &&
    resolved.method !== 'unresolved' && resolved.lat !== undefined && resolved.lon !== undefined;
  const canAcceptTarget = canReview && !!report.target;
  card.innerHTML = `
    <div class="report-head">
      <span class="report-unit" style="color:${UNIT_COLORS[report.unit] ?? '#fff'}">${report.unit}${action ? ' · ' + escapeHtml(action) : ''}</span>
      <span class="report-method ${needs ? 'unresolved' : ''}">${escapeHtml(resolved.method || '?')}${confidence ? ' · ' + confidence : ''}</span>
    </div>
    <div class="report-transcript">${escapeHtml(report.transcript || '')}</div>
    ${resolved.poi_name ? `<div class="report-poi">-> ${escapeHtml(resolved.poi_name)}</div>` : ''}
    ${displayTarget ? `<div class="report-target">${escapeHtml((displayTarget.affiliation || 'unknown').toUpperCase())} · ${escapeHtml(displayTarget.label || displayTarget.entity_type || 'target')}</div>` : ''}
    ${reviewStatus ? `<div class="review-status">${escapeHtml(reviewStatus.replace('_', ' ').toUpperCase())}</div>` : ''}
    ${canReview ? `
      <div class="review-actions">
        ${canAcceptPosition ? '<button type="button" data-review-action="accept_position">ACCEPT POSITION</button>' : ''}
        ${canAcceptTarget ? '<button type="button" data-review-action="accept_target">ACCEPT TARGET</button>' : ''}
        <button type="button" data-review-action="reject">REJECT</button>
      </div>
    ` : ''}
  `;
  card.querySelectorAll<HTMLButtonElement>('button[data-review-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const reviewAction = btn.dataset.reviewAction;
      if (!reviewAction) return;
      sendOperator({ type: 'review_report', report_id: report.id, action: reviewAction });
      setOperatorStatus(`REVIEW ${reviewAction.replace('_', ' ').toUpperCase()}`);
    });
  });
  transcriptLog.appendChild(card);
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
    map.flyTo({ center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
    setOperatorStatus(`FOLLOW TARGET ${formatCoord(target.lat, target.lon)}`);
    return;
  }
  const resolved = report?.resolved || {};
  if (!resolved.needs_review && resolved.lat !== undefined && resolved.lon !== undefined) {
    map.flyTo({ center: [resolved.lon, resolved.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
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

function updateStats() {
  const unitEntries = Object.values(latestUnits || {});
  const activeUnits = unitEntries.filter((u: any) => !!u.last_position).length;
  unitCountEl.textContent = `${activeUnits}/${unitEntries.length || 0}`;
  targetCountEl.textContent = String(latestTargets.length);
  const reviewCount = latestReports.filter((r) => r?.resolved?.needs_review && !r.review_status).length +
    latestTargets.filter((t) => t.needs_review).length;
  reviewCountEl.textContent = String(reviewCount);
  statReview.textContent = String(reviewCount);
  statFriendly.textContent = String(latestTargets.filter((t) => t.affiliation === 'friendly').length + activeUnits);
  statHostile.textContent = String(latestTargets.filter((t) => t.affiliation === 'hostile').length);
  statUnknown.textContent = String(latestTargets.filter((t) => !t.affiliation || t.affiliation === 'unknown').length);
}

function updateClock() {
  operatorClock.textContent = `${new Date().toISOString().slice(11, 19)}Z`;
}

function syncManualControls() {
  const action = mapAction.value;
  manualMapControls.style.display = action === 'pan' ? 'none' : 'flex';
  manualUnit.style.display = action === 'set_unit' ? '' : 'none';
  manualAffiliation.style.display = action === 'manual_target' ? '' : 'none';
  manualEntity.style.display = action === 'manual_target' ? '' : 'none';
}

locateOperatorBtn.addEventListener('click', locateOperator);
resetMissionBtn.addEventListener('click', () => {
  sendOperator({ type: 'reset_mission' });
  setOperatorStatus('MISSION RESET');
});
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
toggle3dBtn.addEventListener('click', () => {
  if (!map) return;
  threeD = !threeD;
  toggle3dBtn.setAttribute('aria-pressed', String(threeD));
  toggle3dBtn.classList.toggle('active', threeD);
  setThreeD(map, threeD);
  setOperatorStatus(threeD ? '3D ON' : '2D ON');
});
mapAction.addEventListener('change', syncManualControls);
document.querySelectorAll<HTMLButtonElement>('.map-mode[data-base-layer]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!map) return;
    baseLayer = btn.dataset.baseLayer as BaseLayer;
    document.querySelectorAll<HTMLButtonElement>('.map-mode[data-base-layer]').forEach((other) => {
      other.classList.toggle('active', other === btn);
    });
    switchBaseLayer(map, baseLayer);
    setOperatorStatus(`${baseLayer.toUpperCase()} MAP`);
  });
});
document.querySelectorAll<HTMLButtonElement>('.data-layer[data-poi-category]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const category = btn.dataset.poiCategory;
    if (!category) return;
    if (activePoiCategories.has(category)) {
      activePoiCategories.delete(category);
      btn.classList.remove('active');
    } else {
      activePoiCategories.add(category);
      btn.classList.add('active');
    }
    renderPresetPois();
  });
});
document.querySelectorAll<HTMLButtonElement>('.filter-btn[data-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('.filter-btn[data-filter]').forEach((other) => {
      other.classList.toggle('active', other === btn);
    });
    targetFilter = btn.dataset.filter || 'all';
    renderTargetList();
  });
});
syncManualControls();
updateClock();
setInterval(updateClock, 1000);
fetchPresets();
