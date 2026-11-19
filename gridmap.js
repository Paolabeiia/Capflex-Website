/* Capflex grid map: one Leaflet map, kept alive between renders and moved into whichever view needs it.
   Layers: land and borders (Natural Earth), German states shaded by a congestion signal (Bundesnetzagentur),
   the high-voltage grid and substations (OpenStreetMap extract in grid.js), and Capflex markers.
   claude.ai pages cannot load map tiles, so everything is drawn from bundled files. */
window.CapflexMap = (function () {
  'use strict';
  var LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  var TOPO = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js';
  var el = document.createElement('div');
  el.className = 'mk-map';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Map of the high-voltage grid, grid congestion by state and Capflex industrial sites');
  var M = { map: null, states: null, stateLayer: null, signal: null, markers: null, links: null, lines: null, hv: null, subs: null, hvDrawn: false, subsDrawn: false, places: null, cities1: null, cities2: null };
  var ready = null, failed = false, api = { onClick: null, failed: function () { return failed; } };

  var VOLT = [
    { min: 380, color: '#0B1F3A', weight: 2.2, opacity: 0.9, label: '380 kV' },
    { min: 220, color: '#3B4A5C', weight: 1.6, opacity: 0.85, label: '220 kV' },
    { min: 150, color: '#7C8A9A', weight: 1.2, opacity: 0.8, label: '150 kV' },
    { min: 0, color: '#9AA6B4', weight: 1, opacity: 0.75, label: '110 kV' }
  ];
  function volt(kv) { for (var i = 0; i < VOLT.length; i++) if (kv >= VOLT[i].min) return VOLT[i]; return VOLT[VOLT.length - 1]; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var CITIES = [
    ['Berlin', 52.52, 13.405, 1], ['Hamburg', 53.551, 9.994, 1], ['Munich', 48.137, 11.575, 1], ['Cologne', 50.938, 6.96, 1], ['Frankfurt', 50.11, 8.682, 1],
    ['Stuttgart', 48.776, 9.183, 1], ['Leipzig', 51.34, 12.375, 1], ['Bremen', 53.079, 8.802, 1], ['Dresden', 51.05, 13.738, 1], ['Hanover', 52.376, 9.732, 1],
    ['Nuremberg', 49.452, 11.077, 1], ['Kiel', 54.323, 10.123, 1], ['Rostock', 54.092, 12.099, 1], ['Magdeburg', 52.12, 11.627, 1], ['Erfurt', 50.978, 11.029, 1],
    ['Düsseldorf', 51.227, 6.774, 2], ['Dortmund', 51.514, 7.468, 2], ['Essen', 51.456, 7.012, 2], ['Bielefeld', 52.03, 8.532, 2], ['Münster', 51.96, 7.626, 2],
    ['Mannheim', 49.488, 8.466, 2], ['Karlsruhe', 49.007, 8.404, 2], ['Augsburg', 48.371, 10.898, 2], ['Kassel', 51.312, 9.48, 2], ['Saarbrücken', 49.24, 6.997, 2],
    ['Freiburg', 47.999, 7.842, 2], ['Regensburg', 49.013, 12.102, 2], ['Würzburg', 49.791, 9.953, 2], ['Chemnitz', 50.827, 12.921, 2], ['Halle', 51.483, 11.97, 2],
    ['Schwerin', 53.635, 11.401, 2], ['Ingolstadt', 48.766, 11.426, 2], ['Osnabrück', 52.279, 8.047, 2], ['Braunschweig', 52.269, 10.521, 2], ['Lübeck', 53.866, 10.687, 2],
    ['Cottbus', 51.756, 14.333, 2], ['Amsterdam', 52.373, 4.89, 1], ['Rotterdam', 51.924, 4.478, 1], ['Eindhoven', 51.441, 5.47, 2], ['Groningen', 53.219, 6.567, 2],
    ['Brussels', 50.85, 4.352, 1], ['Antwerp', 51.219, 4.402, 2], ['Ghent', 51.054, 3.717, 2], ['Vienna', 48.208, 16.373, 1], ['Graz', 47.071, 15.439, 1],
    ['Linz', 48.306, 14.286, 2], ['Salzburg', 47.81, 13.055, 2], ['Innsbruck', 47.269, 11.404, 2], ['Prague', 50.075, 14.438, 1], ['Copenhagen', 55.676, 12.568, 1]
  ];
  var LAND_IDS = ['276', '528', '056', '040', '250', '756', '442', '208', '616', '203', '380', '705', '703', '348', '191', '826', '372', '752', '578', '438', '724', '620'];

  function script(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function load() {
    if (!ready) {
      ready = script(LEAFLET).then(function () { return script(TOPO).catch(function () {}); })
        .then(function () { return window.CAPFLEX_GRID ? null : script('grid.js').catch(function () {}); })
        .then(function () { build(); }, function () { failed = true; el.innerHTML = '<p class="mk-map-fail">The map could not load. Check your connection, then reload the page.</p>'; });
    }
    return ready;
  }
  function build() {
    if (M.map || !window.L) return;
    var map = L.map(el, { minZoom: 4, maxZoom: 13, zoomControl: true, attributionControl: true, zoomSnap: 0.25 });
    M.map = map;
    map.fitBounds([[47.0, 3.2], [55.1, 16.6]]);
    [['land', 200], ['states', 300], ['grid', 410], ['labels', 450], ['links', 600], ['sites', 640]].forEach(function (p) { map.createPane(p[0]).style.zIndex = p[1]; });
    map.getPane('labels').style.pointerEvents = 'none';
    M.landRenderer = L.canvas({ pane: 'land', padding: 0.3 });
    M.gridRenderer = L.canvas({ pane: 'grid', padding: 0.3, tolerance: 4 });
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('Grid &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Borders: Natural Earth · Congestion: Bundesnetzagentur');
    M.lines = L.layerGroup().addTo(map);
    M.hv = L.layerGroup().addTo(map);
    M.subs = L.layerGroup().addTo(map);
    M.places = L.layerGroup().addTo(map);
    M.links = L.layerGroup().addTo(map);
    M.markers = L.layerGroup().addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    var G = window.CAPFLEX_GRID;
    if (G) G.lines.forEach(function (l) { if (l.v >= 150) lineLayer(l).addTo(M.lines); });
    CITIES.forEach(function (c) {
      var g = c[3] === 1 ? (M.cities1 = M.cities1 || L.layerGroup()) : (M.cities2 = M.cities2 || L.layerGroup());
      L.marker([c[1], c[2]], { pane: 'labels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'mk-city' + (c[3] === 1 ? ' major' : ''), html: '<i></i><span>' + esc(c[0]) + '</span>', iconSize: null }) }).addTo(g);
    });
    fetch('geo/countries-50m.json').then(function (r) { return r.json(); }).then(function (topo) {
      if (!window.topojson) return;
      var feats = topojson.feature(topo, topo.objects.countries).features.filter(function (f) { return LAND_IDS.indexOf(f.id) >= 0; });
      L.geoJSON({ type: 'FeatureCollection', features: feats }, { pane: 'land', renderer: M.landRenderer, interactive: false, style: function () { return { color: '#B8C2CD', weight: 0.9, fillColor: '#FCFDFB', fillOpacity: 1 }; } }).addTo(map);
    }).catch(function () {});
    fetch('geo/de-states.json').then(function (r) { return r.json(); }).then(function (gj) {
      M.states = gj;
      paintStates();
    }).catch(function () {});
    map.on('zoomend moveend', zoomLayers);
    zoomLayers();
  }
  function lineLayer(l) {
    var st = volt(l.v), pts = [];
    for (var i = 0; i < l.c.length; i += 2) pts.push([l.c[i], l.c[i + 1]]);
    return L.polyline(pts, { renderer: M.gridRenderer, color: st.color, weight: st.weight, opacity: st.opacity })
      .bindTooltip(esc(l.v + ' kV line') + (l.o ? ' · ' + esc(l.o) : '') + (l.n ? '<br>' + esc(l.n) : ''), { sticky: true, className: 'mk-tip' });
  }
  function zoomLayers() {
    var z = M.map.getZoom(), G = window.CAPFLEX_GRID;
    if (z >= 9 && G) {
      if (!M.hvDrawn) { M.hvDrawn = L.layerGroup(); G.lines.forEach(function (l) { if (l.v < 150) lineLayer(l).addTo(M.hvDrawn); }); }
      if (!M.subsDrawn) {
        M.subsDrawn = L.layerGroup();
        G.subs.forEach(function (s) {
          L.circleMarker([s[0], s[1]], { renderer: M.gridRenderer, radius: s[2] >= 220 ? 4.5 : 3, color: '#0B1F3A', weight: 1.3, fillColor: '#FFFFFF', fillOpacity: 1 })
            .bindTooltip(esc(s[3] || 'Substation') + '<br>' + esc(s[2] + ' kV') + (s[4] ? ' · ' + esc(s[4]) : ''), { className: 'mk-tip' }).addTo(M.subsDrawn);
        });
      }
      if (!M.hv.hasLayer(M.hvDrawn)) M.hv.addLayer(M.hvDrawn);
      if (!M.subs.hasLayer(M.subsDrawn)) M.subs.addLayer(M.subsDrawn);
    } else {
      if (M.hvDrawn && M.hv.hasLayer(M.hvDrawn)) M.hv.removeLayer(M.hvDrawn);
      if (M.subsDrawn && M.subs.hasLayer(M.subsDrawn)) M.subs.removeLayer(M.subsDrawn);
    }
    [[M.cities1, 5], [M.cities2, 7.5]].forEach(function (p) {
      if (!p[0]) return;
      if (z >= p[1]) { if (!M.places.hasLayer(p[0])) M.places.addLayer(p[0]); } else if (M.places.hasLayer(p[0])) M.places.removeLayer(p[0]);
    });
  }

  /* ---------- congestion signal: German states shaded in steps ---------- */
  function paintStates() {
    if (!M.map || !M.states) return;
    if (M.stateLayer) { M.map.removeLayer(M.stateLayer); M.stateLayer = null; }
    var sig = M.signal;
    M.stateLayer = L.geoJSON(M.states, {
      pane: 'states',
      style: function (f) {
        var code = String(f.properties.id || '').replace('DE-', '');
        if (!sig) return { color: '#9AA6B4', weight: 0.8, opacity: 0.7, fillOpacity: 0 };
        var v = sig.data[code], step = v == null ? -1 : sig.steps.filter(function (t) { return v >= t; }).length - 1;
        return { color: '#0B1F3A', weight: 0.6, opacity: 0.45, fillColor: sig.color, fillOpacity: step < 0 ? 0 : sig.alphas[step] };
      },
      onEachFeature: function (f, layer) {
        var code = String(f.properties.id || '').replace('DE-', ''), name = f.properties.name;
        var v = sig ? sig.data[code] : null;
        layer.bindTooltip('<b>' + esc(name) + '</b>' + (sig ? '<br>' + (v == null ? 'No value published' : esc(Math.round(v).toLocaleString('en-GB')) + ' GWh · ' + esc(sig.short)) : ''), { sticky: true, className: 'mk-tip' });
      }
    }).addTo(M.map);
  }
  api.setSignal = function (sig) { M.signal = sig || null; paintStates(); };

  /* ---------- markers ---------- */
  // items: {id, lat, lng, kind:'region'|'pin'|'own'|'sub', label, tip, size}
  api.setMarkers = function (items, links) {
    if (!M.map) return;
    M.markers.clearLayers(); M.links.clearLayers();
    (links || []).forEach(function (ln) {
      L.polyline(ln, { pane: 'links', color: '#0B1F3A', weight: 1.5, dashArray: '4 4', opacity: 0.9, interactive: false }).addTo(M.links);
    });
    items.forEach(function (it) {
      var html, cls = 'mk-mark mk-mark-' + it.kind, size = it.size || 0;
      if (it.kind === 'region') { var d = Math.round(26 + Math.min(30, Math.sqrt(size) * 4)); html = '<span style="width:' + d + 'px;height:' + d + 'px">' + esc(it.label) + '</span>'; }
      else if (it.kind === 'sub') html = '<span></span>';
      else html = '<span></span>' + (it.label ? '<em>' + esc(it.label) + '</em>' : '');
      var mk = L.marker([it.lat, it.lng], { pane: 'sites', keyboard: it.kind !== 'sub', icon: L.divIcon({ className: cls, html: html, iconSize: null }), title: it.title || '' });
      if (it.tip) mk.bindTooltip(it.tip, { className: 'mk-tip', direction: 'top', offset: [0, -10] });
      if (it.kind !== 'sub') mk.on('click', function () { if (api.onClick) api.onClick(it); });
      mk.addTo(M.markers);
    });
  };
  api.view = function (bounds, maxZoom) {
    if (!M.map) return;
    if (!bounds || !bounds.length) { M.map.fitBounds([[47.0, 3.2], [55.1, 16.6]]); return; }
    if (bounds.length === 1) { M.map.setView(bounds[0], maxZoom || 10); return; }
    M.map.fitBounds(bounds, { padding: [70, 70], maxZoom: maxZoom || 10 });
  };

  /* ---------- nearest grid assets (OpenStreetMap) ---------- */
  function km(a, b) {
    var R = 6371, t = Math.PI / 180, dLat = (b[0] - a[0]) * t, dLng = (b[1] - a[1]) * t;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  var near = {};
  api.nearest = function (lat, lng) {
    var G = window.CAPFLEX_GRID; if (!G) return null;
    var key = lat.toFixed(4) + ',' + lng.toFixed(4); if (near[key]) return near[key];
    var here = [lat, lng], sub = null, subD = Infinity, line = null, lineD = Infinity;
    G.subs.forEach(function (s) { var d = km(here, [s[0], s[1]]); if (d < subD) { subD = d; sub = s; } });
    G.lines.forEach(function (l) {
      if (l.v < 220) return;
      var c = l.c;
      if (Math.abs(c[0] - lat) > 1.5 || Math.abs(c[1] - lng) > 2.5) return;
      for (var i = 0; i < c.length; i += 2) { var d = km(here, [c[i], c[i + 1]]); if (d < lineD) { lineD = d; line = l; } }
    });
    return (near[key] = { sub: sub ? { lat: sub[0], lng: sub[1], kv: sub[2], name: sub[3] || 'Unnamed substation', op: sub[4] || '', km: subD } : null, line: line ? { kv: line.v, op: line.o || '', km: lineD } : null });
  };
  api.gridAsOf = function () { return window.CAPFLEX_GRID ? window.CAPFLEX_GRID.asOf : null; };
  api.legend = function () { return VOLT.slice(0, 3); };

  /* ---------- mount into a view ---------- */
  api.attach = function (slot) {
    if (!slot) return Promise.resolve(false);
    if (el.parentNode !== slot) slot.appendChild(el);
    return load().then(function () { if (M.map) { M.map.invalidateSize(); return true; } return false; });
  };
  api.ready = function () { return !!M.map; };
  return api;
})();
