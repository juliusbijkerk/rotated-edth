import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

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
  Alpha: '#36d177',
  Bravo: '#4b8dff',
  Charlie: '#ff7043',
};

export type ArgusMap = maplibregl.Map;
export type ArgusMarker = maplibregl.Marker;
export type BaseLayer = 'dark' | 'satellite' | 'fusion';

export const POI_CATEGORIES = [
  { id: 'critical', label: 'CRITICAL', color: '#ef4444' },
  { id: 'transport', label: 'TRANSPORT', color: '#22c55e' },
  { id: 'power', label: 'POWER', color: '#ff6b35' },
  { id: 'military', label: 'MIL', color: '#8b0000' },
  { id: 'telecom', label: 'TELECOM', color: '#00ff7f' },
  { id: 'humanitarian', label: 'HUMAN', color: '#dc143c' },
  { id: 'industrial', label: 'IND', color: '#f59e0b' },
  { id: 'commercial', label: 'COM', color: '#3b82f6' },
  { id: 'services', label: 'SVC', color: '#8b5cf6' },
  { id: 'accommodation', label: 'LODGING', color: '#06b6d4' },
  { id: 'other', label: 'OTHER', color: '#94a3b8' },
];

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const SATELLITE_STYLE = {
  version: 8,
  name: 'Satellite',
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#000000' } },
    { id: 'satellite-layer', type: 'raster', source: 'satellite' },
  ],
};

const FUSION_STYLE = {
  version: 8,
  name: 'Fusion',
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics',
    },
    carto: {
      type: 'vector',
      url: 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#000000' } },
    { id: 'satellite-layer', type: 'raster', source: 'satellite' },
    {
      id: 'building-walls',
      type: 'fill-extrusion',
      source: 'carto',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': '#7a8ba0',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 18],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.55,
      },
    },
  ],
};

export function createMap(elId: string, centerLatLon: [number, number], zoom: number): ArgusMap {
  const [lat, lon] = centerLatLon;
  const map = new maplibregl.Map({
    container: elId,
    style: FUSION_STYLE as any,
    center: [lon, lat],
    zoom,
    minZoom: 3,
    maxZoom: 19,
    pitch: 52,
    bearing: 12,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
  return map;
}

export function switchBaseLayer(map: ArgusMap, layer: BaseLayer) {
  const style = layer === 'dark' ? DARK_STYLE : layer === 'satellite' ? SATELLITE_STYLE : FUSION_STYLE;
  map.setStyle(style as any);
}

export function setThreeD(map: ArgusMap, enabled: boolean) {
  map.easeTo({
    pitch: enabled ? 60 : 0,
    bearing: enabled ? (map.getBearing() || 18) : 0,
    duration: 450,
  });
}

export function renderPOIs(
  map: ArgusMap,
  pois: POI[],
  options: { maxCount?: number; showLabels?: boolean; categories?: Set<string> } = {},
) {
  const maxCount = options.maxCount ?? 900;
  const showLabels = options.showLabels ?? false;
  const categories = options.categories ?? new Set(['critical', 'transport', 'power', 'military', 'telecom']);
  const features = pois.slice(0, maxCount)
    .map((poi) => {
      const category = poiCategory(poi);
      return {
        type: 'Feature',
        properties: {
          id: poi.id,
          name: poi.name,
          type: poi.type,
          category,
        },
        geometry: {
          type: 'Point',
          coordinates: poi.coords,
        },
      };
    })
    .filter((feature) => categories.has(feature.properties.category));
  const data = { type: 'FeatureCollection', features };

  if (map.getSource('argus-pois')) {
    (map.getSource('argus-pois') as maplibregl.GeoJSONSource).setData(data as any);
  } else {
    map.addSource('argus-pois', { type: 'geojson', data: data as any });
  }

  for (const category of POI_CATEGORIES) {
    const layerId = `argus-poi-${category.id}`;
    const labelId = `argus-poi-label-${category.id}`;
    if (map.getLayer(labelId)) map.removeLayer(labelId);
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (!categories.has(category.id)) continue;
    map.addLayer({
      id: layerId,
      type: 'circle',
      source: 'argus-pois',
      filter: ['==', ['get', 'category'], category.id],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6],
        'circle-color': category.color,
        'circle-opacity': 0.82,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#0a0e17',
      },
    });
    if (showLabels) {
      map.addLayer({
        id: labelId,
        type: 'symbol',
        source: 'argus-pois',
        filter: ['==', ['get', 'category'], category.id],
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#e2e8f0',
          'text-halo-color': '#05080c',
          'text-halo-width': 1.5,
        },
      });
    }
  }
}

export function renderUnitTrails(map: ArgusMap, units: Record<string, any>) {
  const features = Object.entries(units)
    .map(([unit, u]) => {
      const positions = (u.positions || []).map((p: any) => [p.lon, p.lat]);
      return {
        type: 'Feature',
        properties: { unit },
        geometry: { type: 'LineString', coordinates: positions },
      };
    })
    .filter((feature) => feature.geometry.coordinates.length > 1);
  const data = { type: 'FeatureCollection', features };
  if (map.getSource('argus-unit-trails')) {
    (map.getSource('argus-unit-trails') as maplibregl.GeoJSONSource).setData(data as any);
  } else {
    map.addSource('argus-unit-trails', { type: 'geojson', data: data as any });
  }
  if (!map.getLayer('argus-unit-trails')) {
    map.addLayer({
      id: 'argus-unit-trails',
      type: 'line',
      source: 'argus-unit-trails',
      paint: {
        'line-color': ['match', ['get', 'unit'], 'Alpha', UNIT_COLORS.Alpha, 'Bravo', UNIT_COLORS.Bravo, 'Charlie', UNIT_COLORS.Charlie, '#ffcc00'],
        'line-width': 3,
        'line-opacity': 0.72,
        'line-dasharray': [2, 2],
      },
    });
  }
}

export function unitMarker(unit: string, lat: number, lon: number): ArgusMarker {
  const color = UNIT_COLORS[unit] ?? '#ffcc00';
  const el = document.createElement('div');
  el.className = 'unit-marker tactical-marker friendly';
  el.innerHTML = `<div class="unit-dot" style="background:${color}"></div>` +
    `<span class="unit-label" style="color:${color}">${escapeHtml(unit)}</span>`;
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]);
}

export function operatorMarker(lat: number, lon: number): ArgusMarker {
  const el = document.createElement('div');
  el.className = 'operator-marker';
  el.innerHTML = '<div class="operator-pin"><span>OP</span></div>';
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]);
}

export function targetMarker(target: Target): ArgusMarker {
  const affiliation = target.affiliation || 'unknown';
  const code = targetCode(target.entity_type);
  const label = target.label || target.entity_type || 'target';
  const needs = target.needs_review ? ' target-review' : '';
  const el = document.createElement('div');
  el.className = `target-wrap target-${affiliation}${needs}`;
  el.innerHTML =
    `<div class="target-frame"><span>${escapeHtml(code)}</span></div>` +
    `<div class="target-map-label">${escapeHtml(label)}</div>`;
  return new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([target.lon, target.lat])
    .setPopup(new maplibregl.Popup({ offset: 16, closeButton: true }).setHTML(targetPopup(target)));
}

export function markerPopup(html: string): maplibregl.Popup {
  return new maplibregl.Popup({ offset: 16, closeButton: true }).setHTML(html);
}

export function poiCategory(poi: POI): string {
  const [key, value = ''] = (poi.type || '').split('=');
  if (key === 'military') return 'military';
  if (key === 'power') return 'power';
  if (key === 'emergency' || value.includes('shelter') || value.includes('social_facility')) return 'humanitarian';
  if (key === 'healthcare') return 'critical';
  if (key === 'man_made' && /communications_tower|mast|tower/.test(value)) return 'telecom';
  if (key === 'man_made' && /works|wastewater_plant|water_works/.test(value)) return 'industrial';
  if (key === 'landuse' && value === 'industrial') return 'industrial';
  if (key === 'aeroway' || key === 'railway' || key === 'public_transport' || key === 'bridge') return 'transport';
  if (key === 'highway') return 'transport';
  if (key === 'tourism' && /hotel|motel|hostel|apartment/.test(value)) return 'accommodation';
  if (key === 'tourism') return 'commercial';
  if (key === 'shop' || key === 'office') return 'commercial';
  if (key === 'amenity') {
    if (/hospital|school|university|townhall|police|fire_station|clinic/.test(value)) return 'critical';
    if (/restaurant|cafe|bank|bar|pub|fast_food/.test(value)) return 'commercial';
    if (/post_office|pharmacy|fuel|parking|charging_station/.test(value)) return 'services';
    if (/shelter|social_facility/.test(value)) return 'humanitarian';
  }
  if (key === 'historic' || key === 'place') return 'other';
  return 'other';
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
  return `<div class="popup-content">${bits.join('<br>')}</div>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
