# Dyrection

Simple black & white direction maps — for race courses, wedding receptions, event parking, etc.
Built on [OpenFreeMap](https://openfreemap.org) vector tiles and MapLibre GL JS. No build step, no API keys.

## Run it

```bash
cd ~/Documents/software_projects/dyrection && python3 -m http.server 8765
```

Then open http://localhost:8765. (It must be served over http — opening `index.html` directly won't load the ES modules.)

## Using it

- **Search** for a place; `+ Pin` drops a labeled pin there.
- **Labels** tool (default): click any road to show or hide its name. Highways, trunk and primary roads
  (and optionally secondary roads) are always labeled unless you hide them. Highway numbers appear as B&W shields.
  Side-street names only exist in the tiles from zoom 14, so click small streets while zoomed in. Once clicked,
  the app saves that street's shape, so the street and its name stay on the map when you zoom out
  (short streets get a single name at their midpoint).
- **Add pin**: click to drop numbered pins; edit the label and badge (e.g. `P` for parking) in the sidebar. Drag to move.
- **Draw route**: click along the way. Routes snap to roads (Drive / Walk / Bike via routing.openstreetmap.de) or
  use Straight lines. Drag points to adjust, right-click a point to delete it, `Enter` to finish.
- **Road colors**: pick colors for highways, main roads, secondary roads and side streets.
- **Frame**: pick Letter or Square to see exactly what will print.
- **Download PNG**: exports title bar + map + scale bar + attribution at 2–4× resolution.
- Your work autosaves in the browser; **Save project** / **Open project** writes a `.json` file you can keep.

## Files

- `js/style.js` — the black & white MapLibre style (colors, line widths, label rules)
- `js/app.js` — UI, label toggling, pins, routes, export
- `css/app.css` — sidebar and layout

## Services used

Tiles & fonts: OpenFreeMap · Search: Photon (komoot) · Road snapping: FOSSGIS OSRM (routing.openstreetmap.de).
All are free community services — fine for personal use, not for heavy automated traffic.
Map data © OpenStreetMap contributors; the map and exports credit it as "Data from OpenStreetMap".
