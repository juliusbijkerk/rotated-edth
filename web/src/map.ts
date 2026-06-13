import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_ATTR =
  'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, ' +
  'Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';

export interface POI {
  id: string;
  name: string;
  aliases: string[];
  type: string;
  coords: [number, number]; // [lon, lat]
}

export interface Preset {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  center: [number, number]; // [lon, lat]
  zoom: number;
  type: string;
  pois: POI[];
}

export interface Target {
  id: string;
  lat: number;
  lon: number;
  affiliation: 'friendly' | 'hostile' | 'neutral' | 'unknown';
  entity_type: string;
  count?: number;
  echelon?: string;
  label?: string;
  description?: string;
  source_unit?: string;
  confidence?: number;
  needs_review?: boolean;
}

export const UNIT_COLORS: Record<string, string> = {
  Alpha: '#3ee47a',
  Bravo: '#42a5f5',
  Charlie: '#ff7043',
};

export function createMap(elId: string, centerLatLon: [number, number], zoom: number): L.Map {
  const map = L.map(elId, { zoomControl: true, preferCanvas: true }).setView(centerLatLon, zoom);
  L.tileLayer(ESRI_IMAGERY, { attribution: ESRI_ATTR, maxZoom: 19 }).addTo(map);
  return map;
}

export function renderPOIs(map: L.Map, pois: POI[], maxCount = 200): L.LayerGroup {
  const layer = L.layerGroup();
  for (const p of pois.slice(0, maxCount)) {
    const [lon, lat] = p.coords;
    const safeName = p.name.replace(/</g, '&lt;');
    L.marker([lat, lon], {
      icon: L.divIcon({
        className: 'poi-icon',
        html: `<div class="poi-dot"></div><span class="poi-label">${safeName}</span>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      }),
      keyboard: false,
      interactive: false,
    }).addTo(layer);
  }
  layer.addTo(map);
  return layer;
}

export function unitMarker(unit: string, lat: number, lon: number): L.Marker {
  const color = UNIT_COLORS[unit] ?? '#ffcc00';
  return L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'unit-icon',
      html: `<div class="unit-dot" style="background:${color}"></div>` +
            `<span class="unit-label" style="color:${color}">${unit}</span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    }),
  });
}

export function operatorMarker(lat: number, lon: number): L.Marker {
  return L.marker([lat, lon], {
    icon: L.divIcon({
      className: 'operator-icon',
      html: '<div class="operator-pin"><span>OP</span></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    }),
  });
}

export function targetMarker(target: Target): L.Marker {
  const affiliation = target.affiliation || 'unknown';
  const code = targetCode(target.entity_type);
  const label = target.label || target.entity_type || 'target';
  const needs = target.needs_review ? ' target-review' : '';
  const html =
    `<div class="target-wrap target-${affiliation}${needs}">` +
      `<div class="target-frame"><span>${escapeHtml(code)}</span></div>` +
      `<div class="target-map-label">${escapeHtml(label)}</div>` +
    `</div>`;
  return L.marker([target.lat, target.lon], {
    icon: L.divIcon({
      className: 'target-icon',
      html,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    }),
  }).bindPopup(targetPopup(target));
}

function targetCode(entityType: string): string {
  const e = (entityType || '').toLowerCase();
  if (e.includes('tank')) return 'ARM';
  if (e.includes('vehicle')) return 'VEH';
  if (e.includes('drone')) return 'UAV';
  if (e.includes('infantry')) return 'INF';
  if (e.includes('group')) return 'GRP';
  if (e.includes('person')) return 'PAX';
  if (e.includes('building')) return 'BLD';
  return 'UNK';
}

function targetPopup(target: Target): string {
  const bits = [
    `<strong>${escapeHtml(target.label || target.entity_type || 'Target')}</strong>`,
    `Affiliation: ${escapeHtml(target.affiliation || 'unknown')}`,
    `Type: ${escapeHtml(target.entity_type || 'unknown')}`,
  ];
  if (target.count !== undefined && target.count !== null) bits.push(`Count: ${target.count}`);
  if (target.echelon && target.echelon !== 'unknown') bits.push(`Echelon: ${escapeHtml(target.echelon)}`);
  if (target.source_unit) bits.push(`Source: ${escapeHtml(target.source_unit)}`);
  if (target.needs_review) bits.push('Needs review');
  if (target.description) bits.push(escapeHtml(target.description));
  return bits.join('<br>');
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
