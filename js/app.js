import { buildStyle, empty, ROAD_NAME_KEY as KEY, ALWAYS_LABELED, ROAD_COLORS, roadColorByClass } from './style.js';

const STORAGE_KEY = 'dyrection:v1';
const ACCENTS = ['#d62828', '#1d4ed8', '#111111', '#e07a00', '#15803d'];
const FRAMES = { 'letter-l': 11 / 8.5, 'letter-p': 8.5 / 11, square: 1, wide: 16 / 9 };
const MINOR_CLASSES = ['minor', 'service'];
const PATH_CLASSES = ['path', 'track'];
const PROFILES = { car: 'Drive', foot: 'Walk', bike: 'Bike', none: 'Straight' };
const ATTRIBUTION = 'Data from OpenStreetMap';
const TILE_MAX_ZOOM = 14; // OpenFreeMap tiles stop adding detail past z14

const MODE_HINTS = {
  labels: 'Click any road to show or hide its name. Highways and main roads are labeled automatically. Drag pins to move them.',
  pin: 'Click the map to drop a pin. Drag pins to move them. Press <kbd>Esc</kbd> when done.',
  route: 'Click along the way to draw a route. Drag points to adjust; right-click a point to remove it. <kbd>Enter</kbd> finishes.',
};

const defaults = () => ({
  title: '',
  subtitle: '',
  accent: ACCENTS[0],
  colors: { ...ROAD_COLORS },
  frame: 'fit',
  opts: {
    secondaryLabels: true, shields: true, places: true, water: true, waterLabels: true,
    parks: true, buildings: false, rail: true, minor: true, paths: false,
  },
  shown: [],
  hidden: [],
  // Saved geometry for clicked roads: { [name]: [{ cls, z, coords }] }
  kept: {},
  pins: [],
  routes: [],
  activeRoute: null,
  view: { center: [-85.6681, 42.9634], zoom: 13.5 }, // Grand Rapids, MI
});

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, { dataset, ...props } = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
};

let state = load();
let mode = 'labels';
let uid = Date.now();
const newId = () => (uid++).toString(36);

// ---------------------------------------------------------------------------
// Persistence (localStorage is a convenience; "Save project" is the durable copy)

function normalize(data) {
  const d = defaults();
  return { ...d, ...data, opts: { ...d.opts, ...(data?.opts || {}) }, colors: { ...d.colors, ...(data?.colors || {}) }, kept: data?.kept || {}, view: data?.view || d.view };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* storage unavailable or corrupt */ }
  return defaults();
}

function serialize() {
  return JSON.stringify(state, (k, v) => (k.startsWith('_') ? undefined : v));
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, serialize()); } catch { /* ignore */ }
  }, 250);
}

// ---------------------------------------------------------------------------
// Map

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(),
  center: state.view.center,
  zoom: state.view.zoom,
  preserveDrawingBuffer: true, // needed to read the canvas for PNG export
  dragRotate: false,
  pitchWithRotate: false,
  attributionControl: { compact: false },
});
map.touchZoomRotate.disableRotation();
window.dyrection = { map, get state() { return state; } }; // handy for poking around in devtools
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
const scale = new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 120 });
map.addControl(scale, 'bottom-left');

map.on('load', () => {
  addImages();
  applyColors();
  applyOptions();
  applyAccent();
  renderPins();
  renderRoutes();
  setMode('labels');
});

map.on('moveend', () => {
  const c = map.getCenter();
  state.view = { center: [+c.lng.toFixed(6), +c.lat.toFixed(6)], zoom: +map.getZoom().toFixed(2) };
  save();
});

// Once tiles finish loading, pick up more of any clicked road (e.g. parts that scrolled into view).
map.on('idle', () => {
  if (state.shown.length && captureKept(state.shown)) {
    updateKeptSource();
    save();
  }
});

function canvasImage(w, h, ratio, draw) {
  const c = document.createElement('canvas');
  c.width = w * ratio;
  c.height = h * ratio;
  const ctx = c.getContext('2d');
  ctx.scale(ratio, ratio);
  draw(ctx);
  return ctx.getImageData(0, 0, c.width, c.height);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function addImages() {
  const r = 2;
  // Stretchable shield boxes (icon-text-fit grows them around the route number).
  const shield = (fill, stroke) => canvasImage(24, 20, r, (ctx) => {
    roundRect(ctx, 1, 1, 22, 18, 4);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke(); }
  });
  const opts = { pixelRatio: r, stretchX: [[7 * r, 17 * r]], stretchY: [[6 * r, 14 * r]], content: [5 * r, 4 * r, 19 * r, 16 * r] };
  map.addImage('shield-dark', shield('#000000', null), opts);
  map.addImage('shield-light', shield('#ffffff', '#000000'), opts);

  // White chevron pointing along the line direction.
  map.addImage('route-arrow', canvasImage(20, 20, r, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(7, 4);
    ctx.lineTo(13, 10);
    ctx.lineTo(7, 16);
    ctx.stroke();
  }), { pixelRatio: r });
}

// ---------------------------------------------------------------------------
// Layer options + road labels

function setVisible(ids, on) {
  for (const id of [].concat(ids)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

function applyOptions() {
  const o = state.opts;
  setVisible('road-shield', o.shields);
  setVisible('place-label', o.places);
  setVisible(['water', 'waterway'], o.water);
  setVisible(['water-label', 'waterway-label'], o.waterLabels);
  setVisible(['park', 'landcover-wood'], o.parks);
  setVisible('building', o.buildings);
  setVisible('rail', o.rail);
  setVisible(['road-minor', 'road-service'], o.minor);
  setVisible('road-path', o.paths);
  for (const input of document.querySelectorAll('[data-opt]')) input.checked = !!o[input.dataset.opt];
  applyLabels();
}

const autoClasses = () => (state.opts.secondaryLabels ? [...ALWAYS_LABELED, 'secondary'] : ALWAYS_LABELED);
const classIn = (classes) => ['match', ['get', 'class'], classes, true, false];

function applyLabels() {
  const named = ['!=', KEY, ''];
  const hidden = [...(state.opts.minor ? [] : MINOR_CLASSES), ...(state.opts.paths ? [] : PATH_CLASSES)];
  const hideMinor = hidden.length ? [['!', classIn(hidden)]] : [];
  // Clicked roads are labeled from their saved geometry (kept-label) so they survive zooming out;
  // the tile layer only handles them if we have nothing saved.
  const shownFromTiles = state.shown.filter((n) => !state.kept[n]?.length);
  map.setFilter('road-label', ['all', named, ...hideMinor, ['any',
    ['all', classIn(autoClasses()), ['!', ['in', KEY, ['literal', [...state.hidden, ...state.shown]]]]],
    ['in', KEY, ['literal', shownFromTiles]],
  ]]);
  map.setFilter('road-hit', ['all', named, ...hideMinor]);
  const isPoint = ['==', ['geometry-type'], 'Point'];
  map.setFilter('kept-label', ['all', ['!', isPoint], ...hideMinor]);
  map.setFilter('kept-label-point', ['all', isPoint, ...hideMinor]);
  for (const id of ['kept-road-line', 'kept-road-hit']) map.setFilter(id, ['all', ['!', isPoint], ...hideMinor]);
  updateKeptSource();
  renderLabelChips();
}

// Copy the clicked roads' geometry out of the loaded tiles. Small streets only exist in
// zoom-14 tiles, so without this their names (and lines) vanish when you zoom out.
function captureKept(names) {
  const z = Math.min(Math.floor(map.getZoom()), TILE_MAX_ZOOM);
  const features = map.querySourceFeatures('omt', {
    sourceLayer: 'transportation_name',
    filter: ['in', KEY, ['literal', names]],
  });
  let changed = false;
  for (const f of features) {
    const name = f.properties.name;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let saved = state.kept[name] || [];
    const best = saved.reduce((m, l) => Math.max(m, l.z), 0);
    if (z < best) continue; // already have more detailed geometry
    if (z > best && saved.length) { saved = []; changed = true; } // replace coarser geometry
    const seen = new Set(saved.map(lineKey));
    for (const line of lines) {
      const coords = line.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
      const entry = { cls: f.properties.class, z, coords };
      if (coords.length < 2 || seen.has(lineKey(entry))) continue;
      seen.add(lineKey(entry));
      saved.push(entry);
      changed = true;
    }
    state.kept[name] = saved;
  }
  return changed;
}

const lineKey = (l) => `${l.coords[0]}|${l.coords[l.coords.length - 1]}|${l.coords.length}`;

function updateKeptSource() {
  map.getSource('kept-roads')?.setData({
    type: 'FeatureCollection',
    features: state.shown.flatMap((name) => {
      const lines = state.kept[name] || [];
      if (!lines.length) return [];
      return [
        ...lines.map((l) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: l.coords },
          properties: { name, class: l.cls },
        })),
        midpointLabel(name, lines),
      ];
    }),
  });
}

// A point halfway along the road's longest piece, with the road's angle there (kept upright).
function midpointLabel(name, lines) {
  const kx = Math.cos((lines[0].coords[0][1] * Math.PI) / 180); // shrink longitude to match latitude
  const segLen = (a, b) => Math.hypot((b[0] - a[0]) * kx, b[1] - a[1]);
  const lengthOf = (c) => c.slice(1).reduce((sum, p, i) => sum + segLen(c[i], p), 0);
  const longest = lines.reduce((best, l) => (lengthOf(l.coords) > lengthOf(best.coords) ? l : best));
  const c = longest.coords;
  let remaining = lengthOf(c) / 2;
  let i = 0;
  for (; i < c.length - 2 && remaining > segLen(c[i], c[i + 1]); i++) remaining -= segLen(c[i], c[i + 1]);
  const [a, b] = [c[i], c[i + 1]];
  const t = Math.min(1, remaining / (segLen(a, b) || 1));
  let angle = (-Math.atan2(b[1] - a[1], (b[0] - a[0]) * kx) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] },
    properties: { name, class: longest.cls, angle },
  };
}

function isLabelVisible(name, cls) {
  return state.shown.includes(name) || (autoClasses().includes(cls) && !state.hidden.includes(name));
}

function toggleRoadLabel(name, cls) {
  const wasVisible = isLabelVisible(name, cls);
  state.shown = state.shown.filter((n) => n !== name);
  state.hidden = state.hidden.filter((n) => n !== name);
  delete state.kept[name];
  if (wasVisible) {
    if (autoClasses().includes(cls)) state.hidden.push(name);
  } else {
    state.shown.push(name);
    captureKept([name]);
  }
  applyLabels();
  save();
}

function renderLabelChips() {
  const list = $('#label-list');
  list.replaceChildren();
  const chip = (name, off) => {
    const remove = el('button', { className: 'icon', title: off ? 'Show again' : 'Remove label', textContent: '×' });
    remove.addEventListener('click', () => {
      delete state.kept[name];
      state.shown = state.shown.filter((n) => n !== name);
      state.hidden = state.hidden.filter((n) => n !== name);
      applyLabels();
      save();
    });
    return el('li', { className: off ? 'off' : '', title: off ? 'Hidden' : 'Shown' }, name, remove);
  };
  for (const n of state.shown) list.append(chip(n, false));
  for (const n of state.hidden) list.append(chip(n, true));
  if (!list.children.length) {
    list.append(el('li', { className: 'note', textContent: 'Click a road on the map to add or hide its name.' }));
  }
}

// ---------------------------------------------------------------------------
// Pins

function pinCollection() {
  return {
    type: 'FeatureCollection',
    features: state.pins.map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p.lngLat },
      properties: { id: p.id, label: p.label, badge: p.badge || String(i + 1) },
    })),
  };
}

function updatePinSource() {
  map.getSource('pins')?.setData(pinCollection());
}

function addPin(lngLat, label = '') {
  const pin = { id: newId(), lngLat, label, badge: '' };
  state.pins.push(pin);
  renderPins();
  save();
  focusPin(pin.id);
}

function focusPin(id) {
  const input = $(`#pin-list [data-id="${id}"] input.label`);
  if (input) {
    input.scrollIntoView({ block: 'nearest' });
    input.focus();
    input.select();
  }
}

function renderPins() {
  updatePinSource();
  const list = $('#pin-list');
  list.replaceChildren();
  state.pins.forEach((pin, i) => {
    const badge = el('input', {
      type: 'text', className: 'badge', value: pin.badge, placeholder: String(i + 1), maxLength: 2,
      title: 'Badge text (number or letter, e.g. P for parking)',
    });
    badge.style.background = state.accent;
    badge.addEventListener('input', () => { pin.badge = badge.value.trim(); updatePinSource(); save(); });

    const label = el('input', { type: 'text', className: 'label', value: pin.label, placeholder: 'Label (e.g. Start line)' });
    label.addEventListener('input', () => { pin.label = label.value; updatePinSource(); save(); });
    label.addEventListener('keydown', (e) => { if (e.key === 'Enter') label.blur(); });

    const go = el('button', { className: 'icon', title: 'Center map here', textContent: '◎' });
    go.addEventListener('click', () => map.easeTo({ center: pin.lngLat }));

    const del = el('button', { className: 'icon', title: 'Delete pin', textContent: '×' });
    del.addEventListener('click', () => {
      state.pins = state.pins.filter((p) => p !== pin);
      renderPins();
      save();
    });

    list.append(el('li', { dataset: { id: pin.id } }, badge, label, go, del));
  });
  syncEmpty();
}

// ---------------------------------------------------------------------------
// Routes

const segmentCache = new Map();

async function fetchSegment(a, b, profile) {
  if (profile === 'none') return [a, b];
  const key = `${profile}:${a}:${b}`;
  if (segmentCache.has(key)) return segmentCache.get(key);
  const url = `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (json.code === 'Ok' && json.routes?.[0]) {
      const coords = json.routes[0].geometry.coordinates;
      // Tie the snapped path back to the exact points the user clicked.
      const full = [a, ...coords, b];
      segmentCache.set(key, full);
      return full;
    }
  } catch { /* offline or rate limited: fall back to a straight segment */ }
  return [a, b];
}

function cachedOrStraight(a, b, profile) {
  return segmentCache.get(`${profile}:${a}:${b}`) || [a, b];
}

function joinSegments(segs) {
  return segs.reduce((acc, s, i) => acc.concat(i ? s.slice(1) : s), []);
}

async function computeRoute(route) {
  const ver = (route._ver = (route._ver || 0) + 1);
  const pts = route.points;
  const pairs = pts.slice(1).map((b, i) => [pts[i], b]);
  // Draw immediately with whatever we already know, then refine.
  route.geometry = pts.length < 2 ? pts.slice() : joinSegments(pairs.map(([a, b]) => cachedOrStraight(a, b, route.profile)));
  updateRouteSources();
  if (pts.length < 2 || route.profile === 'none') { save(); return; }
  const segs = await Promise.all(pairs.map(([a, b]) => fetchSegment(a, b, route.profile)));
  if (route._ver !== ver) return; // a newer edit superseded this one
  route.geometry = joinSegments(segs);
  updateRouteSources();
  save();
}

function routeCollection() {
  return {
    type: 'FeatureCollection',
    features: state.routes
      .filter((r) => r.geometry?.length >= 2)
      .map((r) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: r.geometry },
        properties: { id: r.id, dashed: !!r.dashed, arrows: !!r.arrows },
      })),
  };
}

function vertexCollection() {
  if (mode !== 'route') return empty();
  return {
    type: 'FeatureCollection',
    features: state.routes.flatMap((r) => r.points.map((p, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: { routeId: r.id, index },
    }))),
  };
}

function updateRouteSources() {
  map.getSource('routes')?.setData(routeCollection());
  map.getSource('route-vertices')?.setData(vertexCollection());
}

function activeRoute() {
  return state.routes.find((r) => r.id === state.activeRoute);
}

function newRoute() {
  const route = {
    id: newId(), name: `Route ${state.routes.length + 1}`, points: [], geometry: [],
    profile: 'car', dashed: false, arrows: true,
  };
  state.routes.push(route);
  state.activeRoute = route.id;
  renderRoutes();
  save();
  return route;
}

function addRoutePoint(lngLat) {
  const route = activeRoute() || newRoute();
  route.points.push(lngLat);
  computeRoute(route);
}

function removeRoutePoint(route, index) {
  route.points.splice(index, 1);
  computeRoute(route);
}

function renderRoutes() {
  updateRouteSources();
  const list = $('#route-list');
  list.replaceChildren();
  for (const route of state.routes) {
    const swatch = el('span', { className: `route-swatch${route.dashed ? ' dashed' : ''}` });
    swatch.style.backgroundColor = state.accent;

    const name = el('input', { type: 'text', value: route.name, placeholder: 'Route name' });
    name.addEventListener('input', () => { route.name = name.value; save(); });

    const del = el('button', { className: 'icon', title: 'Delete route', textContent: '×' });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      state.routes = state.routes.filter((r) => r !== route);
      if (state.activeRoute === route.id) state.activeRoute = null;
      renderRoutes();
      save();
    });

    const profile = el('select', { title: 'How the line follows roads' },
      ...Object.entries(PROFILES).map(([v, label]) => el('option', { value: v, textContent: label, selected: route.profile === v })));
    profile.addEventListener('change', () => { route.profile = profile.value; computeRoute(route); });

    const dashed = el('input', { type: 'checkbox', checked: !!route.dashed });
    dashed.addEventListener('change', () => { route.dashed = dashed.checked; renderRoutes(); save(); });

    const arrows = el('input', { type: 'checkbox', checked: !!route.arrows });
    arrows.addEventListener('change', () => { route.arrows = arrows.checked; updateRouteSources(); save(); });

    const undo = el('button', { className: 'link', textContent: 'Undo point', disabled: !route.points.length });
    undo.addEventListener('click', (e) => {
      e.stopPropagation();
      route.points.pop();
      computeRoute(route);
      renderRoutes();
    });

    const li = el('li', { className: `route-wrap${route.id === state.activeRoute ? ' active' : ''}` },
      el('div', { className: 'route-main' }, swatch, name, del),
      el('div', { className: 'route-opts' },
        profile,
        el('label', {}, dashed, 'Dashed'),
        el('label', {}, arrows, 'Arrows'),
        undo));
    li.addEventListener('click', () => {
      if (state.activeRoute === route.id) return;
      state.activeRoute = route.id;
      renderRoutes();
      save();
    });
    list.append(li);
  }
  syncEmpty();
}

// ---------------------------------------------------------------------------
// Road colors

const ROAD_COLOR_LAYERS = {
  motorway: ['road-motorway', 'road-motorway-ramp'],
  major: ['road-primary'],
  secondary: ['road-secondary'],
  minor: ['road-minor'],
};

function applyColors() {
  for (const [key, ids] of Object.entries(ROAD_COLOR_LAYERS)) {
    for (const id of ids) map.setPaintProperty(id, 'line-color', state.colors[key]);
  }
  map.setPaintProperty('kept-road-line', 'line-color', roadColorByClass(state.colors));
  for (const input of document.querySelectorAll('[data-color-key]')) input.value = state.colors[input.dataset.colorKey];
}

for (const input of document.querySelectorAll('[data-color-key]')) {
  input.addEventListener('input', () => {
    state.colors[input.dataset.colorKey] = input.value;
    applyColors();
    save();
  });
}

$('#reset-colors').addEventListener('click', () => {
  state.colors = { ...ROAD_COLORS };
  applyColors();
  save();
});

// ---------------------------------------------------------------------------
// Accent color

function applyAccent() {
  const c = state.accent;
  map.setPaintProperty('route-line', 'line-color', c);
  map.setPaintProperty('route-line-dashed', 'line-color', c);
  map.setPaintProperty('pin-circle', 'circle-color', c);
  map.setPaintProperty('route-vertex', 'circle-stroke-color', c);
  for (const b of document.querySelectorAll('#accents button')) b.setAttribute('aria-pressed', String(b.dataset.color === c));
  renderPins();
  renderRoutes();
}

for (const color of ACCENTS) {
  const b = el('button', { title: color, dataset: { color } });
  b.style.background = color;
  b.addEventListener('click', () => { state.accent = color; applyAccent(); save(); });
  $('#accents').append(b);
}

// ---------------------------------------------------------------------------
// Modes, clicking, hovering, dragging

function setMode(next) {
  mode = next;
  for (const b of document.querySelectorAll('.mode')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  $('#mode-hint').innerHTML = MODE_HINTS[mode];
  const container = map.getContainer();
  container.classList.toggle('mode-pin', mode === 'pin');
  container.classList.toggle('mode-route', mode === 'route');
  if (mode !== 'labels') clearHover();
  map.doubleClickZoom[mode === 'labels' ? 'enable' : 'disable']();
  updateRouteSources();
}

for (const b of document.querySelectorAll('.mode')) b.addEventListener('click', () => setMode(b.dataset.mode));

const tooltip = $('#tooltip');
let hoveredName = null;

function clearHover() {
  hoveredName = null;
  for (const id of ['road-hover', 'kept-hover']) map.setFilter(id, ['==', KEY, '__none__']);
  tooltip.hidden = true;
  map.getContainer().classList.remove('hovering');
}

function showTooltip(point, html) {
  const mapBox = map.getContainer().getBoundingClientRect();
  const stageBox = $('#stage').getBoundingClientRect();
  tooltip.innerHTML = html;
  tooltip.style.left = `${point.x + mapBox.left - stageBox.left}px`;
  tooltip.style.top = `${point.y + mapBox.top - stageBox.top}px`;
  tooltip.hidden = false;
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function handleLayers() {
  return ['pin-circle', ...(mode === 'route' ? ['route-vertex'] : [])];
}

let hoverFrame = 0;
map.on('mousemove', (e) => {
  if (drag) return;
  cancelAnimationFrame(hoverFrame);
  hoverFrame = requestAnimationFrame(() => {
    const container = map.getContainer();
    const handle = map.queryRenderedFeatures(e.point, { layers: handleLayers() })[0];
    if (handle) {
      clearHover();
      container.classList.add('hovering');
      return;
    }
    if (mode !== 'labels') { container.classList.remove('hovering'); return; }
    const road = map.queryRenderedFeatures(e.point, { layers: ['kept-road-hit', 'road-hit'] })[0];
    const name = road?.properties.name;
    if (!name) { clearHover(); return; }
    if (name !== hoveredName) {
      hoveredName = name;
      for (const id of ['road-hover', 'kept-hover']) map.setFilter(id, ['==', KEY, name]);
    }
    container.classList.add('hovering');
    const verb = isLabelVisible(name, road.properties.class) ? 'hide' : 'show';
    showTooltip(e.point, `${escapeHtml(name)}<small>click to ${verb} label</small>`);
  });
});
map.getCanvas().addEventListener('mouseleave', clearHover);

map.on('click', (e) => {
  const handle = map.queryRenderedFeatures(e.point, { layers: handleLayers() })[0];
  if (handle) {
    if (handle.layer.id === 'pin-circle') focusPin(handle.properties.id);
    return;
  }
  const lngLat = [+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)];
  if (mode === 'pin') return addPin(lngLat);
  if (mode === 'route') {
    addRoutePoint(lngLat);
    renderRoutes();
    return;
  }
  const road = map.queryRenderedFeatures(e.point, { layers: ['kept-road-hit', 'road-hit'] })[0];
  if (road?.properties.name) {
    toggleRoadLabel(road.properties.name, road.properties.class);
    showTooltip(e.point, `${escapeHtml(road.properties.name)}<small>label ${isLabelVisible(road.properties.name, road.properties.class) ? 'shown' : 'hidden'}</small>`);
  }
});

map.on('contextmenu', 'route-vertex', (e) => {
  e.preventDefault();
  const { routeId, index } = e.features[0].properties;
  const route = state.routes.find((r) => r.id === routeId);
  if (route) { removeRoutePoint(route, index); renderRoutes(); }
});

// Dragging pins and route points
let drag = null;

function startDrag(e, info) {
  if (e.originalEvent.button > 0) return;
  e.preventDefault(); // stops the map from panning
  drag = info;
  map.getContainer().classList.add('dragging');
  clearHover();
  const move = (ev) => onDrag(ev.lngLat);
  const end = () => {
    map.off('mousemove', move);
    map.off('touchmove', move);
    map.getContainer().classList.remove('dragging');
    if (drag?.kind === 'vertex') {
      const route = state.routes.find((r) => r.id === drag.routeId);
      if (route) computeRoute(route);
    }
    drag = null;
    save();
  };
  map.on('mousemove', move);
  map.on('touchmove', move);
  map.once('mouseup', end);
  map.once('touchend', end);
}

function onDrag(lngLat) {
  const p = [+lngLat.lng.toFixed(6), +lngLat.lat.toFixed(6)];
  if (drag.kind === 'pin') {
    const pin = state.pins.find((x) => x.id === drag.id);
    if (pin) { pin.lngLat = p; updatePinSource(); }
  } else {
    const route = state.routes.find((r) => r.id === drag.routeId);
    if (route) {
      route.points[drag.index] = p;
      const pts = route.points;
      route.geometry = pts.length < 2 ? pts.slice() : joinSegments(pts.slice(1).map((b, i) => cachedOrStraight(pts[i], b, route.profile)));
      updateRouteSources();
    }
  }
}

for (const type of ['mousedown', 'touchstart']) {
  map.on(type, 'pin-circle', (e) => {
    if (e.points && e.points.length !== 1) return;
    startDrag(e, { kind: 'pin', id: e.features[0].properties.id });
  });
  map.on(type, 'route-vertex', (e) => {
    if (mode !== 'route' || (e.points && e.points.length !== 1)) return;
    const { routeId, index } = e.features[0].properties;
    state.activeRoute = routeId;
    startDrag(e, { kind: 'vertex', routeId, index });
  });
}

document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, select, textarea');
  if (e.key === 'Escape') {
    if (typing) e.target.blur();
    $('#search-results').hidden = true;
    setMode('labels');
  } else if (e.key === 'Enter' && !typing && mode === 'route') {
    setMode('labels');
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing && mode === 'route') {
    const route = activeRoute();
    if (route?.points.length) {
      e.preventDefault();
      route.points.pop();
      computeRoute(route);
      renderRoutes();
    }
  }
});

$('#new-route').addEventListener('click', () => {
  newRoute();
  setMode('route');
});

// ---------------------------------------------------------------------------
// Sidebar controls

for (const input of document.querySelectorAll('[data-opt]')) {
  input.addEventListener('change', () => {
    state.opts[input.dataset.opt] = input.checked;
    applyOptions();
    save();
  });
}

$('#reset-labels').addEventListener('click', () => {
  state.shown = [];
  state.hidden = [];
  state.kept = {};
  applyLabels();
  save();
});

function renderTitle() {
  $('#title').value = state.title;
  $('#subtitle').value = state.subtitle;
  $('#titlebar-title').textContent = state.title;
  $('#titlebar-subtitle').textContent = state.subtitle;
  const had = !$('#titlebar').hidden;
  $('#titlebar').hidden = !state.title && !state.subtitle;
  if (had === $('#titlebar').hidden) map.resize();
}

for (const key of ['title', 'subtitle']) {
  $(`#${key}`).addEventListener('input', (e) => {
    state[key] = e.target.value;
    renderTitle();
    save();
  });
}

function layoutFrame() {
  const stage = $('#stage');
  const box = $('#frame-box');
  const ratio = FRAMES[state.frame];
  stage.classList.toggle('framed', !!ratio);
  if (!ratio) {
    box.style.width = '';
    box.style.height = '';
  } else {
    const pad = 28;
    const W = stage.clientWidth - pad * 2;
    const H = stage.clientHeight - pad * 2;
    let w = W;
    let h = w / ratio;
    if (h > H) { h = H; w = h * ratio; }
    box.style.width = `${Math.floor(w)}px`;
    box.style.height = `${Math.floor(h)}px`;
  }
  map.resize();
}

$('#frame').addEventListener('change', (e) => {
  state.frame = e.target.value;
  layoutFrame();
  save();
});
window.addEventListener('resize', layoutFrame);

function syncEmpty() {
  for (const p of document.querySelectorAll('[data-empty-for]')) {
    p.hidden = document.getElementById(p.dataset.emptyFor).children.length > 0;
  }
}

// ---------------------------------------------------------------------------
// Search (Photon geocoder, biased toward the current map view)

let searchAbort;
$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#search').value.trim();
  const results = $('#search-results');
  if (!q) { results.hidden = true; return; }
  searchAbort?.abort();
  searchAbort = new AbortController();
  results.hidden = false;
  results.replaceChildren(el('li', { className: 'msg', textContent: 'Searching…' }));
  const c = map.getCenter();
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${c.lat}&lon=${c.lng}`,
      { signal: searchAbort.signal },
    );
    const json = await res.json();
    results.replaceChildren();
    if (!json.features?.length) {
      results.append(el('li', { className: 'msg', textContent: 'No matches.' }));
      return;
    }
    for (const f of json.features) results.append(searchResult(f));
  } catch (err) {
    if (err.name !== 'AbortError') results.replaceChildren(el('li', { className: 'msg', textContent: 'Search failed — check your connection.' }));
  }
});

function searchResult(f) {
  const p = f.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const title = p.name || street || p.city || 'Unnamed place';
  const detail = [p.name ? street : '', p.city !== title ? p.city : '', p.state].filter(Boolean).join(', ');
  const coords = f.geometry.coordinates;

  const go = el('button', { className: 'go' }, title, el('small', { textContent: detail }));
  go.addEventListener('click', () => {
    if (p.extent) {
      const [w, n, e, s] = p.extent;
      map.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 16 });
    } else {
      map.flyTo({ center: coords, zoom: 16 });
    }
    $('#search-results').hidden = true;
  });

  const pin = el('button', { className: 'add-pin', title: 'Center here and drop a pin', textContent: '+ Pin' });
  pin.addEventListener('click', () => {
    map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 15) });
    addPin([+coords[0].toFixed(6), +coords[1].toFixed(6)], title);
    $('#search-results').hidden = true;
  });

  return el('li', {}, go, pin);
}

// ---------------------------------------------------------------------------
// PNG export: title bar + map canvas + scale bar + attribution

const idle = () => new Promise((resolve) => map.once('idle', resolve));

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function exportPng() {
  const button = $('#export');
  button.disabled = true;
  button.textContent = 'Rendering…';
  const prevRatio = map.getPixelRatio();
  const prevMode = mode;
  try {
    setMode('labels'); // hides route edit handles
    clearHover();
    const cssW = map.getContainer().clientWidth;
    const cssH = map.getContainer().clientHeight;
    const ratio = Math.min(+$('#export-scale').value, 8000 / Math.max(cssW, cssH));
    map.setPixelRatio(ratio);
    await idle();

    const src = map.getCanvas();
    const s = src.width / cssW;
    const font = getComputedStyle(document.body).fontFamily;
    const out = document.createElement('canvas');
    const ctx = out.getContext('2d');

    // Measure the title block first so the canvas can be sized.
    const padX = 18 * s;
    let titleLines = [];
    let subLines = [];
    const titleFont = `800 ${24 * s}px ${font}`;
    const subFont = `400 ${15 * s}px ${font}`;
    if (state.title) { ctx.font = titleFont; titleLines = wrapLines(ctx, state.title, src.width - padX * 2); }
    if (state.subtitle) { ctx.font = subFont; subLines = wrapLines(ctx, state.subtitle, src.width - padX * 2); }
    const titleLH = 28 * s;
    const subLH = 21 * s;
    const headerH = titleLines.length || subLines.length
      ? 14 * s + titleLines.length * titleLH + (titleLines.length && subLines.length ? 2 * s : 0) + subLines.length * subLH + 12 * s + 2 * s
      : 0;

    out.width = src.width;
    out.height = Math.round(src.height + headerH);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.textBaseline = 'top';

    let y = 14 * s;
    ctx.fillStyle = '#000';
    ctx.font = titleFont;
    for (const line of titleLines) { ctx.fillText(line, padX, y + 1 * s); y += titleLH; }
    if (titleLines.length && subLines.length) y += 2 * s;
    ctx.fillStyle = '#444';
    ctx.font = subFont;
    for (const line of subLines) { ctx.fillText(line, padX, y + 2 * s); y += subLH; }
    if (headerH) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, headerH - 2 * s, out.width, 2 * s);
    }

    ctx.drawImage(src, 0, headerH);

    // Scale bar, copied from MapLibre's on-screen scale control.
    const scaleEl = map.getContainer().querySelector('.maplibregl-ctrl-scale');
    if (scaleEl) {
      const barW = scaleEl.getBoundingClientRect().width * s;
      const x = 12 * s;
      const by = out.height - 14 * s;
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillRect(x - 6 * s, by - 22 * s, barW + 12 * s, 30 * s);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(x, by - 6 * s);
      ctx.lineTo(x, by);
      ctx.lineTo(x + barW, by);
      ctx.lineTo(x + barW, by - 6 * s);
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = `600 ${11 * s}px ${font}`;
      ctx.textBaseline = 'bottom';
      ctx.fillText(scaleEl.textContent, x + 2 * s, by - 6 * s);
    }

    // Attribution (required by OpenStreetMap / OpenMapTiles).
    ctx.font = `${10 * s}px ${font}`;
    ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(ATTRIBUTION).width;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(out.width - tw - 12 * s, out.height - 18 * s, tw + 12 * s, 18 * s);
    ctx.fillStyle = '#333';
    ctx.fillText(ATTRIBUTION, out.width - tw - 6 * s, out.height - 4 * s);

    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    download(blob, `${slug(state.title) || 'map'}.png`);
  } finally {
    map.setPixelRatio(prevRatio);
    setMode(prevMode);
    button.disabled = false;
    button.textContent = 'Download PNG';
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function download(blob, filename) {
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#export').addEventListener('click', exportPng);

// ---------------------------------------------------------------------------
// Project files

$('#save-project').addEventListener('click', () => {
  download(new Blob([serialize()], { type: 'application/json' }), `${slug(state.title) || 'map'}.dyrection.json`);
});

$('#open-project').addEventListener('click', () => $('#project-file').click());
$('#project-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    replaceState(normalize(JSON.parse(await file.text())));
  } catch {
    alert('That file could not be opened as a Dyrection project.');
  }
});

$('#clear-all').addEventListener('click', () => {
  if (!confirm('Remove all pins, routes, label choices and the title?')) return;
  replaceState({ ...defaults(), view: state.view });
});

function replaceState(next) {
  state = next;
  map.jumpTo({ center: state.view.center, zoom: state.view.zoom });
  applyColors();
  applyOptions();
  applyAccent();
  renderTitle();
  $('#frame').value = state.frame;
  layoutFrame();
  save();
}

// ---------------------------------------------------------------------------
// Initial UI

renderTitle();
$('#frame').value = state.frame;
layoutFrame();
renderPins();
renderRoutes();
renderLabelChips();
