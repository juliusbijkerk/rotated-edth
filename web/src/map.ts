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

export function drawAO(map: L.Map, bbox: [number, number, number, number]): L.LayerGroup {
  const [w, s, e, n] = bbox;
  const layer = L.layerGroup();
  // Dim everything OUTSIDE the AO so the operational box reads at a glance:
  // a world-covering polygon with the AO cut out as a hole.
  const world: L.LatLngExpression[] = [[-89, -179], [89, -179], [89, 179], [-89, 179]];
  const hole: L.LatLngExpression[] = [[s, w], [s, e], [n, e], [n, w]];
  L.polygon([world, hole], {
    stroke: false, fillColor: '#04070a', fillOpacity: 0.4, interactive: false,
  }).addTo(layer);
  // Bright dashed border marking the AO edge.
  L.rectangle([[s, w], [n, e]], {
    color: '#ffffff', weight: 1.5, opacity: 0.85, fill: false, dashArray: '6 5', interactive: false,
  }).addTo(layer);
  layer.addTo(map);
  return layer;
}
