// Black & white MapLibre style built on OpenFreeMap's OpenMapTiles vector tiles.
// Every toggleable layer has a stable id so app.js can flip visibility / filters
// without rebuilding the style.

export const ROAD_NAME_KEY = ['to-string', ['get', 'name']];

// Road classes whose names are labeled automatically (unless the user hides one).
export const ALWAYS_LABELED = ['motorway', 'trunk', 'primary'];

// Default road colors; the sidebar color pickers override these at runtime.
export const ROAD_COLORS = {
  motorway: '#000000',
  major: '#1a1a1a',
  secondary: '#3d3d3d',
  minor: '#8f8f8f',
};

// Color expression for layers that mix road classes (kept roads).
export function roadColorByClass(colors) {
  return ['match', ['get', 'class'],
    'motorway', colors.motorway,
    ['trunk', 'primary'], colors.major,
    ['secondary', 'tertiary'], colors.secondary,
    colors.minor];
}

const FONT_REGULAR = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];

const C = {
  paper: '#ffffff',
  water: '#d4d4d4',
  waterLine: '#bdbdbd',
  park: '#efefef',
  building: '#e4e4e4',
  ...ROAD_COLORS,
  service: '#b8b8b8',
  path: '#b0b0b0',
  rail: '#9a9a9a',
  ink: '#000000',
  muted: '#6b6b6b',
  halo: '#ffffff',
};

const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const isPoly = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const notTunnel = ['!=', ['get', 'brunnel'], 'tunnel'];
const classIn = (...classes) => ['match', ['get', 'class'], classes, true, false];
const isInterstate = ['==', ['get', 'network'], 'us-interstate'];
const bareRef = ['!', ['in', ' ', ['to-string', ['get', 'ref']]]];

// Exponential width ramp: [[zoom, width], ...]
const width = (stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()];

// Shared by tile road labels and the user's "kept" road labels so they look identical.
const roadLabelLayout = {
  'symbol-placement': 'line',
  'symbol-spacing': 320,
  'symbol-sort-key': ['match', ['get', 'class'], 'motorway', 0, 'trunk', 1, 'primary', 2, 'secondary', 3, 'tertiary', 4, 5],
  'text-field': ['to-string', ['get', 'name']],
  'text-font': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], ['literal', FONT_BOLD], ['literal', FONT_REGULAR]],
  'text-size': [
    'interpolate', ['linear'], ['zoom'],
    12, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 11.5, 10.5],
    16, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 15, ['secondary', 'tertiary'], 13.5, 12.5],
  ],
  'text-rotation-alignment': 'map',
  'text-pitch-alignment': 'viewport',
  'text-max-angle': 35,
  // Sit names just beside the road so the line doesn't show through word gaps.
  'text-offset': ['interpolate', ['linear'], ['zoom'],
    12, ['literal', [0, -0.85]], 16, ['literal', [0, -1.0]], 18, ['literal', [0, -1.45]]],
};
const roadLabelPaint = { 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 2 };

function road(id, classes, color, widthStops, extra = {}) {
  return {
    id,
    type: 'line',
    source: 'omt',
    'source-layer': 'transportation',
    minzoom: extra.minzoom ?? 0,
    filter: ['all', isLine, classIn(...classes), ...(extra.filter || [])],
    layout: { 'line-cap': 'round', 'line-join': 'round', ...(extra.layout || {}) },
    paint: { 'line-color': color, 'line-width': width(widthStops), ...(extra.paint || {}) },
  };
}

export function buildStyle() {
  return {
    version: 8,
    name: 'Dyrection B&W',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">Data from OpenStreetMap</a>',
      },
      'kept-roads': { type: 'geojson', data: empty() },
      routes: { type: 'geojson', data: empty() },
      'route-vertices': { type: 'geojson', data: empty() },
      pins: { type: 'geojson', data: empty() },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': C.paper } },

      // ---- Area fills ----
      {
        id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', filter: isPoly,
        paint: { 'fill-color': C.park },
      },
      {
        id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover',
        filter: ['all', isPoly, classIn('wood', 'grass')],
        paint: { 'fill-color': C.park, 'fill-opacity': 0.7 },
      },
      {
        id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water',
        filter: ['all', isPoly, notTunnel],
        paint: { 'fill-color': C.water },
      },
      {
        id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
        filter: ['all', isLine, notTunnel],
        paint: { 'line-color': C.water, 'line-width': width([[8, 0.5], [14, 2], [18, 6]]) },
      },
      {
        id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-color': C.building, 'fill-outline-color': '#d0d0d0' },
      },

      // ---- Hover glow (sits under the roads) ----
      {
        id: 'road-hover', type: 'line', source: 'omt', 'source-layer': 'transportation_name',
        filter: ['==', ROAD_NAME_KEY, '__none__'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffcf33', 'line-opacity': 0.75, 'line-width': width([[10, 6], [14, 14], [18, 40]]) },
      },

      {
        id: 'kept-hover', type: 'line', source: 'kept-roads',
        filter: ['==', ROAD_NAME_KEY, '__none__'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffcf33', 'line-opacity': 0.75, 'line-width': width([[8, 6], [14, 14], [18, 40]]) },
      },
      {
        // Clicked roads keep drawing when zoomed out past where the tiles include them.
        id: 'kept-road-line', type: 'line', source: 'kept-roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': roadColorByClass(ROAD_COLORS),
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
            8, 1, 12, ['match', ['get', 'class'], ['minor', 'service', 'path', 'track'], 1.3, 1.6],
            14, ['match', ['get', 'class'], ['minor', 'service', 'path', 'track'], 1.4, 2.6],
            18, ['match', ['get', 'class'], ['minor', 'service', 'path', 'track'], 9, 14]],
        },
      },

      // ---- Roads, drawn minor → major so the big ones sit on top ----
      road('road-path', ['path', 'track'], C.path, [[14, 0.6], [18, 2]], {
        minzoom: 14, paint: { 'line-dasharray': [1.5, 1.5] }, layout: { 'line-cap': 'butt' },
      }),
      road('road-service', ['service'], C.service, [[13, 0.4], [16, 1.5], [18, 5]], { minzoom: 13 }),
      road('road-minor', ['minor'], C.minor, [[12, 0.5], [14, 1.2], [16, 3], [18, 9]], { minzoom: 11 }),
      road('road-tunnel', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], '#9a9a9a',
        [[10, 0.8], [14, 3], [18, 14]], {
          filter: [['==', ['get', 'brunnel'], 'tunnel']],
          paint: { 'line-dasharray': [2, 1.5] }, layout: { 'line-cap': 'butt' },
        }),
      road('road-secondary', ['secondary', 'tertiary'], C.secondary, [[9, 0.5], [12, 1.4], [14, 2.6], [16, 5], [18, 14]], {
        minzoom: 9, filter: [notTunnel],
      }),
      road('road-primary', ['primary', 'trunk'], C.major, [[6, 0.5], [10, 1.6], [14, 4], [16, 7.5], [18, 20]], {
        minzoom: 6, filter: [notTunnel],
      }),
      road('road-motorway', ['motorway'], C.motorway, [[5, 0.6], [10, 2.2], [14, 5.5], [16, 10], [18, 26]], {
        minzoom: 5, filter: [notTunnel, ['!=', ['get', 'ramp'], 1]],
      }),
      road('road-motorway-ramp', ['motorway', 'trunk', 'primary'], C.motorway, [[10, 0.8], [14, 2.4], [18, 10]], {
        minzoom: 11, filter: [notTunnel, ['==', ['get', 'ramp'], 1]],
      }),
      road('rail', ['rail', 'transit'], C.rail, [[10, 0.6], [14, 1.4], [18, 3]], {
        minzoom: 10, filter: [notTunnel], paint: { 'line-dasharray': [3, 2] }, layout: { 'line-cap': 'butt' },
      }),

      // Invisible fat lines used only for click / hover hit-testing on named roads.
      {
        id: 'road-hit', type: 'line', source: 'omt', 'source-layer': 'transportation_name',
        filter: ['!=', ROAD_NAME_KEY, ''],
        paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 },
      },

      {
        id: 'kept-road-hit', type: 'line', source: 'kept-roads',
        paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 },
      },

      // ---- User routes ----
      {
        id: 'route-casing', type: 'line', source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': width([[10, 7], [14, 12], [16, 17], [18, 28]]) },
      },
      {
        id: 'route-line', type: 'line', source: 'routes', filter: ['!=', ['get', 'dashed'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#d62828', 'line-width': width([[10, 4], [14, 7.5], [16, 11], [18, 20]]) },
      },
      {
        id: 'route-line-dashed', type: 'line', source: 'routes', filter: ['==', ['get', 'dashed'], true],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#d62828', 'line-width': width([[10, 4], [14, 7.5], [16, 11], [18, 20]]), 'line-dasharray': [1.6, 1.1] },
      },
      {
        id: 'route-arrows', type: 'symbol', source: 'routes', filter: ['==', ['get', 'arrows'], true],
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': 70, 'icon-image': 'route-arrow',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 14, 0.9, 16, 1.15, 18, 1.6],
          'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map',
        },
      },

      // ---- Labels ----
      {
        id: 'water-label', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
        filter: ['!', isLine],
        layout: {
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': FONT_ITALIC,
          'text-size': 12, 'text-max-width': 6, 'text-letter-spacing': 0.1,
        },
        paint: { 'text-color': C.muted, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
      },
      {
        id: 'waterway-label', type: 'symbol', source: 'omt', 'source-layer': 'waterway', minzoom: 12,
        filter: ['all', isLine, ['has', 'name']],
        layout: {
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']], 'text-font': FONT_ITALIC,
          'text-size': 11.5, 'symbol-placement': 'line', 'text-letter-spacing': 0.1,
        },
        paint: { 'text-color': C.muted, 'text-halo-color': C.halo, 'text-halo-width': 1.2 },
      },
      {
        // Filter is replaced at runtime by app.js (always-labeled classes + user toggles).
        id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 10,
        filter: ['all', ['!=', ROAD_NAME_KEY, ''], classIn(...ALWAYS_LABELED)],
        layout: roadLabelLayout,
        paint: roadLabelPaint,
      },
      {
        id: 'road-shield', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 7,
        filter: ['all', ['has', 'ref'], ['<=', ['get', 'ref_length'], 6], classIn('motorway', 'trunk', 'primary')],
        layout: {
          'symbol-placement': ['step', ['zoom'], 'point', 9, 'line'],
          'symbol-spacing': 360,
          'symbol-sort-key': ['match', ['get', 'class'], 'motorway', 0, 'trunk', 1, 2],
          'icon-image': ['case', ['all', isInterstate, bareRef], 'shield-dark', 'shield-light'],
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [2, 5, 2, 5],
          'icon-rotation-alignment': 'viewport',
          'text-rotation-alignment': 'viewport',
          // Some refs already carry a prefix ("US 131"); only add one to bare numbers.
          'text-field': [
            'case',
            ['!', bareRef], ['get', 'ref'],
            isInterstate, ['concat', 'I-', ['get', 'ref']],
            ['==', ['get', 'network'], 'us-highway'], ['concat', 'US ', ['get', 'ref']],
            ['get', 'ref'],
          ],
          'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 11.5],
        },
        paint: { 'text-color': ['case', ['all', isInterstate, bareRef], '#ffffff', '#000000'] },
      },
      {
        id: 'place-label', type: 'symbol', source: 'omt', 'source-layer': 'place',
        filter: classIn('city', 'town', 'village', 'suburb', 'neighbourhood', 'quarter'),
        layout: {
          'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
          'text-font': ['match', ['get', 'class'], ['city', 'town'], ['literal', FONT_BOLD], ['literal', FONT_REGULAR]],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.12,
          'text-max-width': 8,
          'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13, 11],
          'symbol-sort-key': ['match', ['get', 'class'], 'city', 0, 'town', 1, 'village', 2, 3],
        },
        paint: { 'text-color': C.muted, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
      },

      {
        // Roads the user clicked on, drawn from geometry app.js saved, so they stay labeled at any zoom.
        // Zoomed in, the name runs along the road; zoomed out, short streets can't fit a name along
        // them, so one label sits at the street's midpoint, rotated to match it.
        id: 'kept-label', type: 'symbol', source: 'kept-roads', minzoom: 14,
        layout: roadLabelLayout,
        paint: roadLabelPaint,
      },
      {
        id: 'kept-label-point', type: 'symbol', source: 'kept-roads', maxzoom: 14,
        layout: (({ 'symbol-spacing': _s, 'text-max-angle': _a, ...rest }) => ({
          ...rest,
          'symbol-placement': 'point',
          'text-rotate': ['get', 'angle'],
          'text-max-width': 40,
        }))(roadLabelLayout),
        paint: roadLabelPaint,
      },

      // ---- User pins (always on top) ----
      {
        id: 'pin-circle', type: 'circle', source: 'pins',
        paint: {
          'circle-color': '#d62828', 'circle-radius': 11,
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5,
        },
      },
      {
        id: 'pin-badge', type: 'symbol', source: 'pins',
        layout: {
          'text-field': ['get', 'badge'], 'text-font': FONT_BOLD, 'text-size': 12,
          'text-allow-overlap': true, 'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff' },
      },
      {
        id: 'pin-label', type: 'symbol', source: 'pins',
        layout: {
          'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 15,
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1.25, 'text-justify': 'auto', 'text-max-width': 12,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': C.ink, 'text-halo-color': C.halo, 'text-halo-width': 2.5 },
      },
      {
        id: 'route-vertex', type: 'circle', source: 'route-vertices',
        paint: {
          'circle-color': '#ffffff', 'circle-radius': 5,
          'circle-stroke-color': '#d62828', 'circle-stroke-width': 2.5,
        },
      },
    ],
  };
}

export function empty() {
  return { type: 'FeatureCollection', features: [] };
}
