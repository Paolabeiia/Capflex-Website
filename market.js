/* Capflex Site Match: an anonymous marketplace for spare grid capacity at industrial sites.
   Factories offer capacity. Public: region, grid area, voltage, capacity, space, timing.
   Private (only the lister and Capflex can read it): company, address, contact.
   Developers register projects of any kind and bid a one-off fee to Capflex in EUR per MW.
   The highest EUR/MW gets first right to sign; capacity is allocated in bid order until it runs out.

   Storage: Supabase tables listings, projects, bids, site_private, project_private (see the SQL migration). */
(function () {
  'use strict';

  /* ---------- reference data ---------- */
  var COUNTRIES = { DE: 'Germany', NL: 'Netherlands', AT: 'Austria', BE: 'Belgium' };
  var REGIONS = {
    DE: [['BW', 'Baden-Württemberg'], ['BY', 'Bavaria'], ['BE', 'Berlin'], ['BB', 'Brandenburg'], ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hesse'], ['MV', 'Mecklenburg-Vorpommern'], ['NI', 'Lower Saxony'], ['NW', 'North Rhine-Westphalia'], ['RP', 'Rhineland-Palatinate'], ['SL', 'Saarland'], ['SN', 'Saxony'], ['ST', 'Saxony-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thuringia']],
    NL: [['DR', 'Drenthe'], ['FL', 'Flevoland'], ['FR', 'Friesland'], ['GE', 'Gelderland'], ['GR', 'Groningen'], ['LI', 'Limburg'], ['NB', 'North Brabant'], ['NH', 'North Holland'], ['OV', 'Overijssel'], ['ZH', 'South Holland'], ['UT', 'Utrecht'], ['ZE', 'Zeeland']],
    AT: [['B', 'Burgenland'], ['K', 'Carinthia'], ['NO', 'Lower Austria'], ['S', 'Salzburg'], ['ST', 'Styria'], ['T', 'Tyrol'], ['OO', 'Upper Austria'], ['W', 'Vienna'], ['V', 'Vorarlberg']],
    BE: [['BRU', 'Brussels'], ['VLG', 'Flanders'], ['WAL', 'Wallonia']]
  };
  var GRID_DE = { BW: 'TransnetBW', BY: 'TenneT', BE: '50Hertz', BB: '50Hertz', HB: 'TenneT', HH: '50Hertz', HE: 'TenneT', MV: '50Hertz', NI: 'TenneT', NW: 'Amprion', RP: 'Amprion', SL: 'Amprion', SN: '50Hertz', ST: '50Hertz', SH: 'TenneT', TH: '50Hertz' };
  function gridArea(c, r) { if (c === 'DE') return GRID_DE[r] || ''; if (c === 'NL') return 'TenneT'; if (c === 'BE') return 'Elia'; if (c === 'AT') return r === 'V' ? 'VÜN' : 'APG'; return ''; }
  var VOLTAGES = [['LV', 'Low voltage'], ['MV', 'Medium voltage'], ['HV', 'High voltage'], ['EHV', 'Extra-high voltage']];
  var TYPES = {
    battery:      { label: 'Battery storage', short: 'BAT', pool: 'import', area: 250, unit: 'MW' },
    solar:        { label: 'Solar park', short: 'PV', pool: 'export', area: 12000, unit: 'MWp' },
    wind:         { label: 'Wind turbine', short: 'WIND', pool: 'export', area: 5000, unit: 'MW' },
    datacentre:   { label: 'Data centre', short: 'DC', pool: 'firm', area: 400, unit: 'MW' },
    electrolyser: { label: 'Electrolyser', short: 'H2', pool: 'import', area: 350, unit: 'MW' },
    charging:     { label: 'Charging hub', short: 'EV', pool: 'import', area: 600, unit: 'MW' },
    heat:         { label: 'Power-to-heat', short: 'P2H', pool: 'import', area: 150, unit: 'MW' }
  };
  var TYPE_ORDER = ['battery', 'solar', 'wind', 'datacentre', 'electrolyser', 'charging', 'heat'];
  var POOL_TEXT = { import: 'free import capacity', export: 'free feed-in capacity', firm: 'firm import capacity, available around the clock' };
  var AUCTION_DAYS = [7, 14, 30];
  var BID_STEP = 100;
  var DAY = 86400000;
  var COLS = ['listings', 'projects', 'bids'];

  // Who is looking. Each view shows its own tabs; the choice is remembered in this browser only.
  var ROLES = {
    developer: { label: 'Developer', tabs: ['matches', 'map', 'projects', 'rules'] },
    industry: { label: 'Industry', tabs: ['listings', 'map', 'rules'] },
    capflex: { label: 'Capflex', tabs: ['matches', 'map', 'desk', 'rules'], owner: true }
  };
  // Approximate region centres: the marketplace never shows more than this to developers.
  var CENTER = {
    'DE:BW': [48.66, 9.35], 'DE:BY': [48.95, 11.4], 'DE:BE': [52.52, 13.4], 'DE:BB': [52.2, 13.9], 'DE:HB': [53.08, 8.8], 'DE:HH': [53.55, 10.0],
    'DE:HE': [50.6, 9.03], 'DE:MV': [53.77, 12.57], 'DE:NI': [52.76, 9.39], 'DE:NW': [51.48, 7.55], 'DE:RP': [49.91, 7.45], 'DE:SL': [49.38, 6.95],
    'DE:SN': [51.05, 13.35], 'DE:ST': [51.95, 11.69], 'DE:SH': [54.22, 9.7], 'DE:TH': [50.9, 11.03],
    'NL:DR': [52.86, 6.62], 'NL:FL': [52.53, 5.6], 'NL:FR': [53.11, 5.85], 'NL:GE': [52.06, 5.95], 'NL:GR': [53.22, 6.74], 'NL:LI': [51.21, 5.93],
    'NL:NB': [51.56, 5.18], 'NL:NH': [52.58, 4.87], 'NL:OV': [52.44, 6.45], 'NL:ZH': [52.02, 4.49], 'NL:UT': [52.08, 5.18], 'NL:ZE': [51.45, 3.85],
    'AT:B': [47.5, 16.48], 'AT:K': [46.72, 13.86], 'AT:NO': [48.27, 15.76], 'AT:S': [47.45, 13.05], 'AT:ST': [47.25, 14.95], 'AT:T': [47.22, 11.3],
    'AT:OO': [48.1, 13.95], 'AT:W': [48.21, 16.37], 'AT:V': [47.25, 9.9], 'BE:BRU': [50.85, 4.36], 'BE:VLG': [51.05, 4.4], 'BE:WAL': [50.35, 4.8]
  };
  // Grid congestion by German state, from the Bundesnetzagentur's annual congestion management reports (GWh).
  var SRC21 = 'https://www.bundesnetzagentur.de/SharedDocs/Downloads/DE/Sachgebiete/Energie/Unternehmen_Institutionen/Versorgungssicherheit/Engpassmanagement/Zahlen%20Ganzes%20Jahr2021.pdf?__blob=publicationFile&v=4';
  var SRC22 = 'https://bundesnetzagentur.de/SharedDocs/Downloads/DE/Sachgebiete/Energie/Unternehmen_Institutionen/Versorgungssicherheit/Engpassmanagement/Ganzjahreszahlen2022.pdf?__blob=publicationFile&v=1';
  var SURPLUS_FIT = 'Fits projects that take power off the grid: batteries, electrolysers, power-to-heat and data centres.';
  var SIGNALS = {
    curtail: { tab: 'Renewables curtailed', title: 'Wind and solar curtailed, 2021', short: 'wind and solar curtailed', kind: 'Too much power', color: '#B5DE5C', alphas: [0.1, 0.28, 0.48, 0.68, 0.9],
      meaning: 'The grid could not carry all the wind and solar power away, so plants were switched off.', fits: SURPLUS_FIT,
      data: { NI: 2643, SH: 1856, BB: 432, ST: 287, MV: 255, NW: 131, BY: 108, RP: 41, TH: 32, HE: 25, BW: 5, SN: 2, BE: 0, SL: 0 },
      src: ['Bundesnetzagentur, congestion management report 2021, table 12', SRC21] },
    down: { tab: 'Plants turned down', title: 'Power plants turned down, 2022', short: 'plants turned down', kind: 'Too much power', color: '#B5DE5C', alphas: [0.1, 0.28, 0.48, 0.68, 0.9],
      meaning: 'Plants here were turned down because the grid could not carry their power away.', fits: SURPLUS_FIT,
      data: { NI: 5532, BB: 2115, SH: 1441, SN: 1279, BY: 774, NW: 771, ST: 667, MV: 661, HB: 387, HE: 134, TH: 52, RP: 45, BW: 4, BE: 4, SL: 4 },
      src: ['Bundesnetzagentur, congestion management report 2022, table 8', SRC22] },
    up: { tab: 'Plants turned up', title: 'Power plants turned up, 2022', short: 'plants turned up', kind: 'Too little power', color: '#0B1F3A', alphas: [0.06, 0.16, 0.28, 0.42, 0.58],
      meaning: 'Plants here were turned up because power from the north could not get through.', fits: 'Fits projects that deliver power when it is short: batteries and flexible generation.',
      data: { BW: 4059, NW: 1787, NI: 819, BY: 459, RP: 379, SL: 265, HE: 258, ST: 13, HB: 11, SN: 4, BB: 3, TH: 3, MV: 2, BE: 0 },
      src: ['Bundesnetzagentur, congestion management report 2022, table 8', SRC22] }
  };
  var SIG_STEPS = [0, 50, 250, 1000, 2500];
  function readRole() { try { var r = localStorage.getItem('capflex-role'); return ROLES[r] ? r : 'developer'; } catch (e) { return 'developer'; } }
  function saveRole(r) { try { localStorage.setItem('capflex-role', r); } catch (e) {} }

  /* ---------- state ---------- */
  var state = {
    listings: [], projects: [], bids: [], privSites: {}, privProjects: {}, desk: {}, demoPriv: null,
    loaded: { listings: false, projects: false, bids: false }, slow: false,
    mode: 'connecting', me: null, isOwner: false, canWrite: true, role: readRole(),
    view: 'matches', sel: null, filters: { type: 'all', country: 'all', sort: 'free', project: 'all', closed: false },
    signal: 'curtail', mapRegion: null,
    bid: { projectId: '', perMW: '' }, confirm: null, editing: { site: null, project: null }, now: Date.now()
  };

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function fmt(x, d) { return Number(x).toLocaleString('en-GB', { maximumFractionDigits: d == null ? 1 : d, minimumFractionDigits: 0 }); }
  function money(x) { return '€' + Math.round(x).toLocaleString('en-GB'); }
  function moneyShort(x) { if (x >= 1e6) return '€' + (x / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 2 }) + 'm'; if (x >= 1e4) return '€' + Math.round(x / 1e3) + 'k'; return money(x); }
  function mIdx(v) { if (!v || !/^\d{4}-\d{2}$/.test(v)) return 0; var p = v.split('-'); return (+p[0]) * 12 + (+p[1]); }
  function mon(v) { if (!mIdx(v)) return '—'; var p = v.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function regionName(c, r) { var list = REGIONS[c] || []; for (var i = 0; i < list.length; i++) if (list[i][0] === r) return list[i][1]; return r || ''; }
  function place(l) { return regionName(l.country, l.region) + ' · ' + (COUNTRIES[l.country] || l.country || ''); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function proj(id) { return byId(state.projects, id); }
  function listing(id) { return byId(state.listings, id); }
  function T(type) { return TYPES[type] || TYPES.battery; }
  function mine(x) { return !!(x && state.me && x.ownerId === state.me); }
  function rnd3() { return String(Math.floor(100 + Math.random() * 900)); }
  function typeBadge(t, extra) { return '<span class="tb" title="' + esc(T(t).label) + '">' + esc(T(t).short) + (extra ? '<i>' + esc(extra) + '</i>' : '') + '</span>'; }
  function size(p) { return fmt(n(p.mw)) + ' ' + T(p.type).unit; }
  function loaded() { return state.mode === 'local' || (state.mode === 'db' && state.loaded.listings && state.loaded.projects && state.loaded.bids); }

  // Demo auctions run on a rolling 15-day clock so the demo never goes stale; real ones close at a fixed time.
  function closesAt(l) {
    if (l.sample && n(l.demoCloseDays)) {
      var P = 15 * DAY, off = ((n(l.demoCloseDays) * DAY - (state.now % P)) % P + P) % P;
      return state.now + (off || P);
    }
    return n(l.closesAt);
  }
  function isOpen(l) { return closesAt(l) > state.now; }
  function closingSoon(l) { return isOpen(l) && closesAt(l) - state.now < 2 * DAY; }
  function timeLeft(ms) {
    var d = ms - state.now;
    if (d <= 0) return 'Closed';
    var days = Math.floor(d / DAY), h = Math.floor((d % DAY) / 3600000), m = Math.floor((d % 3600000) / 60000);
    if (days > 0) return days + 'd ' + String(h).padStart(2, '0') + 'h';
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
  }

  var toastTimer = null;
  function toast(msg, bad) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 4200);
  }

  /* ---------- capacity, fit and allocation ---------- */
  function cap(l) {
    var conn = n(l.connectionMW), peak = n(l.peakMW), flex = Math.max(0, Math.min(n(l.flexMW), peak));
    var firm = Math.max(0, conn - peak);
    return { conn: conn, peak: peak, flex: flex, firm: firm, imp: firm + flex, exp: Math.max(0, n(l.feedInMW)) };
  }
  function poolAvail(c, type) { var pool = T(type).pool; return pool === 'export' ? c.exp : pool === 'firm' ? c.firm : c.imp; }
  function areaNeed(p) { return n(p.areaM2) || n(p.mw) * T(p.type).area; }
  function fit(l, p) {
    var c = cap(l), mw = Math.max(0.001, n(p.mw));
    var sameCountry = l.country === p.country;
    var regionOk = sameCountry && (!p.regions || !p.regions.length || p.regions.indexOf(l.region) >= 0);
    var vOk = (p.voltages || []).indexOf(l.voltage) >= 0;
    var capFit = Math.min(1, poolAvail(c, p.type) / mw);
    var spaceFit = Math.min(1, n(l.areaM2) / Math.max(1, areaNeed(p)));
    var gap = (mIdx(l.availableFrom) && mIdx(p.cod)) ? mIdx(l.availableFrom) - mIdx(p.cod) : 0;
    var timing = gap <= 0 ? 1 : gap <= 6 ? 0.5 : 0;
    var score = Math.round(45 * capFit + 20 * spaceFit + 15 * (vOk ? 1 : 0) + 10 * (regionOk ? 1 : sameCountry ? 0.4 : 0) + 10 * timing);
    var ok = sameCountry && vOk && capFit >= 0.5 && spaceFit >= 0.5 && l.ownerId !== p.ownerId;
    if (!ok) score = Math.min(score, 49);
    return { ok: ok, score: score, label: !ok ? 'No fit' : score >= 80 ? 'Strong' : score >= 60 ? 'Good' : 'Possible' };
  }
  function matchesFor(l) {
    return state.projects.map(function (p) { return { p: p, f: fit(l, p) }; }).filter(function (m) { return m.f.ok; })
      .sort(function (a, b) { return b.f.score - a.f.score; });
  }
  // A bid counts only if it comes from the project's own developer and meets the minimum.
  function validBid(b) {
    var p = proj(b.projectId), l = listing(b.listingId);
    return !!(p && l && p.ownerId === b.ownerId && l.ownerId !== b.ownerId && n(b.perMW) >= n(l.reservePerMW));
  }
  function bidsFor(lid) {
    return state.bids.filter(function (b) { return b.listingId === lid && validBid(b); })
      .sort(function (a, b) { return n(b.perMW) - n(a.perMW) || n(a.placedAt) - n(b.placedAt); });
  }
  function myBid(pid, lid) { return state.bids.filter(function (b) { return mine(b) && b.projectId === pid && b.listingId === lid; })[0] || null; }
  // Hand capacity out in order: import (loads, batteries), firm (data centres), feed-in (solar, wind).
  function allocateProjects(l, list) {
    var c = cap(l), imp = c.imp, firm = c.firm, exp = c.exp, out = [];
    list.forEach(function (p) {
      var mw = n(p.mw), pool = T(p.type).pool, ok = false;
      if (pool === 'export') { if (mw <= exp + 1e-9) { exp -= mw; ok = true; } }
      else if (pool === 'firm') { if (mw <= firm + 1e-9 && mw <= imp + 1e-9) { firm -= mw; imp -= mw; ok = true; } }
      else if (mw <= imp + 1e-9) { imp -= mw; firm = Math.min(firm, imp); ok = true; }
      out.push(ok);
    });
    return { ok: out, impLeft: Math.max(0, imp), expLeft: Math.max(0, exp), cap: c };
  }
  function allocate(l, bids) {
    var res = allocateProjects(l, bids.map(function (b) { return proj(b.projectId); }));
    return {
      rows: bids.map(function (b, i) { var p = proj(b.projectId); return { bid: b, p: p, rank: i + 1, allocated: res.ok[i], total: n(b.perMW) * n(p.mw) }; }),
      impLeft: res.impLeft, expLeft: res.expLeft, cap: res.cap
    };
  }
  function bestCombo(l) {
    var ms = matchesFor(l), res = allocateProjects(l, ms.map(function (m) { return m.p; }));
    var picked = ms.filter(function (m, i) { return res.ok[i]; });
    return { picked: picked, impUsed: res.cap.imp - res.impLeft, expUsed: res.cap.exp - res.expLeft, cap: res.cap };
  }
  function topBid(lid) { var b = bidsFor(lid); return b.length ? n(b[0].perMW) : 0; }

  /* ---------- data: Supabase. Everyone reads the marketplace; signed-in people write their own rows;
     row level security keeps company names and exact locations visible only to the lister and Capflex. ---------- */
  var CFG = window.CAPFLEX_CONFIG || {};
  // A sign-in link can come back as "#matches#access_token=…"; keep only the token part so Supabase can read it.
  (function () {
    var h = location.hash || '', i = h.indexOf('access_token=');
    if (i > 1 && h.charAt(i - 1) === '#') { try { history.replaceState(null, '', location.pathname + location.search + '#' + h.slice(i)); } catch (e) {} }
  })();
  var sb = (window.supabase && CFG.url && CFG.key) ? window.supabase.createClient(CFG.url, CFG.key, { auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } }) : null;
  function ts(v) { var t = Date.parse(v); return isFinite(t) ? t : 0; }
  function owner(r) { return r.owner || ('demo~' + (r.demo_owner || 'x')); }
  function rowListing(r) {
    return { id: r.id, key: r.id, ownerId: owner(r), sample: !!r.sample, code: r.code, country: r.country, region: r.region, voltage: r.voltage,
      connectionMW: n(r.connection_mw), peakMW: n(r.peak_mw), flexMW: n(r.flex_mw), feedInMW: n(r.feed_in_mw), areaM2: n(r.area_m2),
      availableFrom: r.available_from, reservePerMW: n(r.reserve_per_mw), closesAt: ts(r.closes_at), demoCloseDays: r.demo_close_days, createdAt: ts(r.created_at) };
  }
  function rowProject(r) {
    return { id: r.id, key: r.id, ownerId: owner(r), sample: !!r.sample, type: r.type, code: r.code, mw: n(r.mw), mwh: n(r.mwh), areaM2: n(r.area_m2),
      voltages: r.voltages || [], country: r.country, regions: r.regions || [], cod: r.cod, createdAt: ts(r.created_at) };
  }
  function rowBid(r) {
    return { id: r.id, key: r.id, ownerId: owner(r), sample: !!r.sample, listingId: r.listing_id, projectId: r.project_id, perMW: n(r.per_mw), placedAt: ts(r.placed_at), createdAt: ts(r.created_at) };
  }
  function newKey(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function must(p) { return Promise.resolve(p).then(function (r) { if (r && r.error) throw r.error; return r; }); }
  function write(p, ok) {
    return Promise.resolve(p).then(function () { if (ok) toast(ok); loadAll(); return true; }).catch(function (e) {
      var code = e && e.code;
      if (code === '42501') toast('That change is not allowed for your account.', true);
      else if (code === '23505') toast('That already exists. Reload the page and try again.', true);
      else toast('Could not save. Check your connection and try again.', true);
      loadAll();
      return false;
    });
  }
  var loading = null, again = false;
  function loadAll() {
    if (!sb) return Promise.resolve();
    if (loading) { again = true; return loading; }
    loading = Promise.all([
      sb.from('listings').select('*'), sb.from('projects').select('*'), sb.from('bids').select('*'),
      sb.from('site_private').select('*'), sb.from('project_private').select('*')
    ]).then(function (res) {
      if (res[0].error || res[1].error || res[2].error) throw res[0].error || res[1].error || res[2].error;
      state.listings = res[0].data.map(rowListing);
      state.projects = res[1].data.map(rowProject);
      state.bids = res[2].data.map(rowBid);
      state.privSites = {}; (res[3].data || []).forEach(function (r) { state.privSites[r.listing_id] = { company: r.company, address: r.address, contact: r.contact, lat: r.lat, lng: r.lng }; });
      state.privProjects = {}; (res[4].data || []).forEach(function (r) { state.privProjects[r.project_id] = { company: r.company, contact: r.contact }; });
      state.loaded = { listings: true, projects: true, bids: true }; state.slow = false;
    }).catch(function () { toast('Could not load the marketplace. Reload the page to try again.', true); })
      .then(function () { loading = null; render(); if (again) { again = false; loadAll(); } });
    return loading;
  }
  var reloadTimer = null;
  function reloadSoon() { clearTimeout(reloadTimer); reloadTimer = setTimeout(loadAll, 400); }
  function setUser(session) {
    var u = session && session.user;
    state.me = u ? u.id : null; state.email = u ? (u.email || '') : ''; state.canWrite = true; state.isOwner = false;
    if (u) sb.rpc('am_admin').then(function (r) { state.isOwner = !!(r && r.data); if (!state.isOwner && state.role === 'capflex') state.role = 'developer'; render(); });
    else if (state.role === 'capflex') state.role = 'developer';
    render();
  }
  function connect() {
    if (!sb) { state.mode = 'local'; state.loaded = { listings: true, projects: true, bids: true }; render(); return; }
    state.mode = 'db';
    setTimeout(function () { if (!loaded()) { state.slow = true; render(); } }, 10000);
    sb.auth.getSession().then(function (r) { setUser(r.data && r.data.session); loadAll(); });
    sb.auth.onAuthStateChange(function (ev, session) {
      if (ev === 'INITIAL_SESSION') return;
      setUser(session); reloadSoon();
      // Back from the email link: open Site Match instead of the landing page.
      if (ev === 'SIGNED_IN') setTimeout(function () { var h = location.hash.slice(1); if (!h || h.indexOf('access_token') >= 0) location.hash = 'matches'; }, 0);
    });
    sb.channel('market').on('postgres_changes', { event: '*', schema: 'public' }, reloadSoon).subscribe();
  }
  function openSignIn() {
    var d = $('#dlg-signin'); if (!d) return;
    $('#si-msg').textContent = ''; $('#si-error').textContent = '';
    d.showModal();
  }
  function submitSignIn(e) {
    e.preventDefault();
    var email = $('#si-email').value.trim(), pass = $('#si-pass').value;
    $('#si-error').textContent = ''; $('#si-msg').textContent = '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#si-error').textContent = 'Enter a valid email address.'; return; }
    if (!pass) { $('#si-error').textContent = 'Enter your password, or use the email link.'; return; }
    var btn = $('#si-submit'); btn.disabled = true;
    sb.auth.signInWithPassword({ email: email, password: pass }).then(function (r) {
      btn.disabled = false;
      if (r.error) { $('#si-error').textContent = /invalid/i.test(r.error.message || '') ? 'Email or password is wrong.' : 'Could not sign in: ' + r.error.message; return; }
      $('#si-pass').value = '';
      $('#dlg-signin').close();
      toast('Signed in as ' + email + '.');
      if (location.hash !== '#matches' && ['#matches', '#map', '#projects', '#listings', '#rules', '#desk'].indexOf(location.hash) < 0) location.hash = 'matches';
    });
  }
  function sendSignInLink() {
    var email = $('#si-email').value.trim();
    $('#si-error').textContent = ''; $('#si-msg').textContent = '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#si-error').textContent = 'Enter your email first.'; return; }
    sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
      if (r.error) { $('#si-error').textContent = /not authori[sz]ed/i.test(r.error.message || '') ? 'Sign-in links go to the Capflex team only for now.' : /rate limit/i.test(r.error.message || '') ? 'Too many emails right now. Use your password, or try again in an hour.' : 'Could not send the link: ' + r.error.message; return; }
      $('#si-msg').textContent = 'Check your inbox: we sent a sign-in link to ' + email + '.';
    });
  }
  function submitPassword(e) {
    e.preventDefault();
    var pw = $('#pw-new').value;
    $('#pw-error').textContent = ''; $('#pw-msg').textContent = '';
    if (pw.length < 8) { $('#pw-error').textContent = 'Use at least 8 characters.'; return; }
    var btn = $('#pw-submit'); btn.disabled = true;
    sb.auth.updateUser({ password: pw }).then(function (r) {
      btn.disabled = false;
      if (r.error) { $('#pw-error').textContent = 'Could not save: ' + r.error.message; return; }
      $('#pw-new').value = ''; $('#dlg-pass').close(); toast('Password changed.');
    });
  }


  /* ---------- header: live numbers, tabs, status ---------- */
  function renderHead() {
    var st = $('#status');
    if (st) {
      st.className = 'status' + (state.mode === 'db' ? ' live' : state.mode === 'local' ? ' local' : '');
      st.lastElementChild.textContent = state.mode === 'db' ? 'Live marketplace' : state.mode === 'local' ? 'Offline preview' : 'Connecting';
    }
    var au = $('#auth');
    if (au) au.innerHTML = !sb ? '' : state.me ? '<span class="mk-auth"><span title="Signed in">' + esc(state.email) + '</span><button class="btn btn-small btn-quiet" type="button" data-action="password">Password</button><button class="btn btn-small btn-quiet" type="button" data-action="signout">Sign out</button></span>' : '<button class="btn btn-small" type="button" data-action="signin">Sign in</button>';
    var role = ROLES[state.role] ? state.role : 'developer';
    var rs = $('#roles');
    if (rs) rs.innerHTML = '<span>View as</span>' + Object.keys(ROLES).filter(function (r) { return !ROLES[r].owner || state.isOwner; }).map(function (r) {
      return '<button type="button" data-action="role" data-v="' + r + '" aria-pressed="' + (r === role) + '">' + esc(ROLES[r].label) + '</button>';
    }).join('');
    var k = $('#kpis');
    if (k && role === 'industry') {
      var fs = factory(), sites = fs.sites.filter(isOpen), bidsN = 0, req = 0, lead = 0;
      sites.forEach(function (l) { var r = allocate(l, bidsFor(l.id)).rows; bidsN += r.length; r.forEach(function (x) { req += n(x.p.mw); if (x.allocated) lead += x.total; }); });
      k.innerHTML = kpi(fs.sites.length, '', 'Your industrial sites') + kpi(fmt(fs.sites.reduce(function (a, l) { return a + cap(l).imp; }, 0)), 'MW', 'Capacity you offer') +
        kpi(bidsN, '', 'Bids received') + kpi(fmt(req), 'MW', 'Capacity requested');
    } else if (k) {
      var open = state.listings.filter(isOpen);
      var freeMW = open.reduce(function (a, l) { return a + cap(l).imp; }, 0);
      var liveBids = 0, leading = 0;
      open.forEach(function (l) { var r = allocate(l, bidsFor(l.id)).rows; liveBids += r.length; r.forEach(function (x) { if (x.allocated) leading += x.total; }); });
      k.innerHTML = kpi(open.length, '', 'Industrial sites open') + kpi(fmt(freeMW), 'MW', 'Free import capacity') +
        kpi(liveBids, '', 'Live bids') + kpi(moneyShort(leading), '', 'Leading bids, total fees');
    }
    var counts = { matches: state.listings.filter(isOpen).length, projects: state.projects.filter(mine).length, listings: factory().sites.length };
    $$('#tabs a').forEach(function (a) {
      var v = a.getAttribute('href').slice(1);
      a.hidden = ROLES[role].tabs.indexOf(v) < 0;
      if (v === state.view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      var base = a.getAttribute('data-label') || a.textContent; a.setAttribute('data-label', base);
      a.innerHTML = esc(base) + (counts[v] ? '<span class="count">' + counts[v] + '</span>' : '');
    });
    $$('[data-requires-write]').forEach(function (b) {
      var roles = b.getAttribute('data-roles');
      b.hidden = !state.canWrite || (!!roles && roles.split(' ').indexOf(role) < 0);
    });
    var ot = $('#owner-tools');
    if (ot) {
      var hasDemo = state.listings.some(function (x) { return x.sample; }) || state.projects.some(function (x) { return x.sample; });
      ot.innerHTML = (state.isOwner && hasDemo) ? '<span>Demo marketplace is showing.</span><button class="btn btn-small" type="button" data-action="remove-demo">Remove demo data</button>' : '';
    }
  }
  function kpi(v, unit, label) { return '<div class="kpi"><span>' + esc(label) + '</span><b>' + esc(v) + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</b></div>'; }

  /* ---------- marketplace ---------- */
  function filteredListings() {
    var f = state.filters, myP = f.project !== 'all' ? proj(f.project) : null;
    var rows = state.listings.filter(function (l) {
      if (!f.closed && !isOpen(l)) return false;
      if (f.country !== 'all' && l.country !== f.country) return false;
      if (f.type !== 'all' && !matchesFor(l).some(function (m) { return m.p.type === f.type; }) && poolAvail(cap(l), f.type) < 1) return false;
      if (myP && !fit(l, myP).ok) return false;
      return true;
    });
    rows.sort(function (a, b) {
      if (f.sort === 'closing') return closesAt(a) - closesAt(b);
      if (f.sort === 'bid') return topBid(b.id) - topBid(a.id);
      if (f.sort === 'new') return n(b.createdAt) - n(a.createdAt);
      if (f.sort === 'fit' && myP) return fit(b, myP).score - fit(a, myP).score;
      return cap(b).imp - cap(a).imp;
    });
    return rows;
  }
  function matchBadges(l) {
    var counts = {};
    matchesFor(l).forEach(function (m) { counts[m.p.type] = (counts[m.p.type] || 0) + 1; });
    var keys = TYPE_ORDER.filter(function (t) { return counts[t]; });
    if (!keys.length) return '<span class="mk-dim">None yet</span>';
    return '<span class="mk-badges">' + keys.map(function (t) { return typeBadge(t, counts[t] > 1 ? '×' + counts[t] : ''); }).join('') + '</span>';
  }
  function closesCell(l) {
    var at = closesAt(l), cls = !isOpen(l) ? 'mk-pill closed' : closingSoon(l) ? 'mk-pill soon' : 'mk-pill';
    return '<span class="' + cls + '" data-closes="' + esc(l.id) + '">' + esc(timeLeft(at)) + '</span>';
  }
  function viewMatches() {
    var f = state.filters, myProjects = state.projects.filter(mine);
    var h = '<div class="mk-head"><div><h2 class="mk-title">Marketplace.</h2><p class="mk-sub">Industrial sites with free grid capacity. Company names and exact locations stay private until a site signs.</p></div></div>';
    h += '<div class="mk-toolbar"><div class="mk-seg" role="group" aria-label="Project type">' + [['all', 'All']].concat(TYPE_ORDER.map(function (t) { return [t, TYPES[t].label]; })).map(function (o) {
      return '<button type="button" data-action="f-type" data-v="' + o[0] + '" aria-pressed="' + (f.type === o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div><div class="mk-selects">';
    h += '<label class="mk-sel"><span>Country</span><select id="mk-f-country"><option value="all">All countries</option>' + Object.keys(COUNTRIES).map(function (c) { return '<option value="' + c + '"' + (f.country === c ? ' selected' : '') + '>' + COUNTRIES[c] + '</option>'; }).join('') + '</select></label>';
    if (myProjects.length) h += '<label class="mk-sel"><span>Fits my project</span><select id="mk-f-project"><option value="all">Any project</option>' + myProjects.map(function (p) { return '<option value="' + esc(p.id) + '"' + (f.project === p.id ? ' selected' : '') + '>' + esc(p.code) + ' · ' + esc(T(p.type).label) + '</option>'; }).join('') + '</select></label>';
    h += '<label class="mk-sel"><span>Sort</span><select id="mk-f-sort">' + [['free', 'Most free capacity'], ['closing', 'Closing soonest'], ['bid', 'Highest bid'], ['new', 'Newest']].concat(f.project !== 'all' ? [['fit', 'Best fit']] : []).map(function (o) { return '<option value="' + o[0] + '"' + (f.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>';
    h += '<label class="mk-check"><input type="checkbox" id="mk-f-closed"' + (f.closed ? ' checked' : '') + '> Show closed</label></div></div>';

    if (!loaded()) return h + (state.slow ? '<div class="mk-empty-line">The marketplace is taking longer than usual to load. Check your connection; it appears here as soon as it answers.</div>' : '<p class="loading">Loading the marketplace…</p>');
    if (!state.listings.length) return h + emptyMarket();
    var rows = filteredListings();
    if (!rows.length) return h + '<div class="mk-empty-line">No industrial site fits these filters. Change the type, country or project.</div>';
    var myP = f.project !== 'all' ? proj(f.project) : null;
    h += '<div class="mk-tablewrap"><table class="mk-table mk-market"><thead><tr>' +
      '<th>Industrial site</th><th>Grid</th><th class="r">Free capacity</th><th class="r">Space</th><th>Available</th><th>Matching projects</th>' + (myP ? '<th class="r">Fit</th>' : '') + '<th class="r">Leading bid</th><th class="r">Closes in</th></tr></thead><tbody>';
    rows.forEach(function (l) {
      var c = cap(l), bids = bidsFor(l.id), top = bids.length ? n(bids[0].perMW) : 0;
      var share = c.conn ? Math.min(100, c.imp / c.conn * 100) : 0;
      h += '<tr data-action="open" data-id="' + esc(l.id) + '"' + (state.sel === l.id ? ' class="is-sel"' : '') + '>';
      h += '<td class="mk-c-site"><button class="mk-code" type="button" data-action="open" data-id="' + esc(l.id) + '">' + esc(l.code) + '</button>' + (mine(l) ? '<span class="mk-own">Yours</span>' : '') + (l.sample ? '<span class="mk-demo">Demo</span>' : '') + '<span class="mk-place">' + esc(place(l)) + '</span></td>';
      h += '<td data-l="Grid"><span class="mk-volt">' + esc(l.voltage) + '</span><span class="mk-place">' + esc(gridArea(l.country, l.region)) + '</span></td>';
      h += '<td class="r" data-l="Free capacity"><span class="mk-mw">' + fmt(c.imp) + '<small>MW</small></span><span class="mk-mini" aria-hidden="true"><i style="width:' + share.toFixed(1) + '%"></i></span><span class="mk-place">' + fmt(c.exp) + ' MW feed-in</span></td>';
      h += '<td class="r" data-l="Space"><span class="mk-mw">' + fmt(n(l.areaM2), 0) + '<small>m²</small></span></td>';
      h += '<td data-l="Available">' + esc(mon(l.availableFrom)) + '</td>';
      h += '<td data-l="Matching projects">' + matchBadges(l) + '</td>';
      if (myP) { var fr = fit(l, myP); h += '<td class="r" data-l="Fit"><span class="mk-mw">' + fr.score + '</span><span class="mk-place">' + esc(fr.label) + '</span></td>'; }
      h += '<td class="r" data-l="Leading bid">' + (top ? '<span class="mk-mw">' + money(top) + '<small>/MW</small></span><span class="mk-place">' + bids.length + ' bid' + (bids.length === 1 ? '' : 's') + '</span>' : '<span class="mk-dim">No bids</span><span class="mk-place">from ' + money(n(l.reservePerMW)) + '/MW</span>') + '</td>';
      h += '<td class="r" data-l="Closes in">' + closesCell(l) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<p class="mk-foot">Free capacity is what the site\'s grid connection has left after the factory\'s own peak, plus load the factory can shift. Feed-in is the export the connection allows.</p>';
    return h;
  }
  function emptyMarket() {
    var h = '<div class="mk-empty"><p class="mk-label">Marketplace</p><h3>No industrial sites listed yet.</h3><p>Factories offer the grid capacity they don\'t use. Developers register projects and bid for first right to sign.</p>';
    if (state.canWrite) h += '<div class="mk-acts"><button class="btn btn-dark" type="button" data-action="new-site">Offer capacity</button><button class="btn" type="button" data-action="new-project">Register a project</button></div>';
    return h + '</div>';
  }

  /* ---------- the drawer: one industrial site, its matches and the bidding ---------- */
  function renderDrawer() {
    var root = $('#mk-drawer-root'); if (!root) return;
    var l = state.sel ? listing(state.sel) : null;
    if (!l || document.documentElement.getAttribute('data-page') === 'home') {
      if (root.innerHTML) { root.innerHTML = ''; root.removeAttribute('data-for'); }
      root.hidden = true; document.documentElement.classList.remove('mk-lock'); return;
    }
    root.hidden = false;
    document.documentElement.classList.add('mk-lock');
    var form = root.querySelector('#mk-bidform');
    var keepForm = !!(form && form.contains(document.activeElement));
    if (!root.querySelector('.mk-drawer') || root.getAttribute('data-for') !== l.id) {
      root.setAttribute('data-for', l.id);
      root.innerHTML = '<div class="mk-scrim" data-action="close"></div><aside class="mk-drawer" role="dialog" aria-modal="true" aria-labelledby="mk-d-title"><div id="mk-d-head"></div><div class="mk-dscroll"><div id="mk-d-body"></div><div id="mk-d-bid"></div></div></aside>';
      keepForm = false;
      state.bid = { projectId: '', perMW: '' };
      setTimeout(function () { var c = root.querySelector('.mk-x'); if (c) c.focus(); }, 30);
    }
    var c = cap(l), alloc = allocate(l, bidsFor(l.id)), matches = matchesFor(l), combo = bestCombo(l);
    $('#mk-d-head').innerHTML = '<div class="mk-dhead"><div><p class="mk-label">Industrial site' + (l.sample ? ' · Demo' : '') + '</p><h2 class="mk-dcode" id="mk-d-title">' + esc(l.code) + '</h2><p class="mk-dplace">' + esc(place(l)) + ' · ' + esc(gridArea(l.country, l.region)) + ' area · ' + esc(l.voltage) + '</p></div><div class="mk-dright">' + closesCell(l) + '<button class="mk-x" type="button" data-action="close" aria-label="Close">×</button></div></div>';

    var b = '<section class="mk-dsec"><div class="mk-big">' +
      '<div><span class="mk-label">Free import</span><b>' + fmt(c.imp) + '<small>MW</small></b><span>' + fmt(c.firm) + ' MW firm + ' + fmt(c.flex) + ' MW flexible</span></div>' +
      '<div><span class="mk-label">Feed-in allowed</span><b>' + fmt(c.exp) + '<small>MW</small></b><span>For solar and wind</span></div>' +
      '<div><span class="mk-label">Free area</span><b>' + fmt(n(l.areaM2), 0) + '<small>m²</small></b><span>From ' + esc(mon(l.availableFrom)) + '</span></div></div>';
    b += capBar(c, alloc) + '</section>';

    b += '<section class="mk-dsec"><div class="mk-row"><p class="mk-label">Bids, highest first</p><span class="mk-dim">Minimum ' + money(n(l.reservePerMW)) + '/MW</span></div>';
    if (alloc.rows.length) {
      b += '<table class="mk-mini-table"><thead><tr><th>#</th><th>Project</th><th class="r">Size</th><th class="r">Fee</th><th>Status</th></tr></thead><tbody>';
      alloc.rows.forEach(function (r) {
        var you = mine(r.bid);
        b += '<tr' + (you ? ' class="you"' : '') + '><td class="mk-rank">' + r.rank + '</td><td>' + typeBadge(r.p.type) + '<span class="mk-pcode">' + esc(r.p.code) + '</span>' + (you ? '<span class="mk-own">You</span>' : '') + '</td><td class="r">' + size(r.p) + '</td><td class="r"><b>' + money(n(r.bid.perMW)) + '</b><span class="mk-place">' + moneyShort(r.total) + ' total</span></td><td>' + (r.allocated ? '<span class="mk-st in">In allocation</span>' : '<span class="mk-st wait">Waiting</span>') + '</td></tr>';
      });
      b += '</tbody></table>';
    } else b += '<p class="mk-dim">No bids yet. The first bid at or above ' + money(n(l.reservePerMW)) + ' per MW takes first right.</p>';
    b += '</section>';

    b += '<section class="mk-dsec"><div class="mk-row"><p class="mk-label">Matching projects</p><span class="mk-dim">' + matches.length + '</span></div>';
    if (matches.length) {
      b += '<ul class="mk-mlist">' + matches.map(function (m) {
        var hasBid = alloc.rows.some(function (r) { return r.p.id === m.p.id; });
        return '<li>' + typeBadge(m.p.type) + '<span class="mk-pcode">' + esc(m.p.code) + '</span><span class="mk-msize">' + size(m.p) + '</span><span class="mk-fitchip"><b>' + m.f.score + '</b> ' + esc(m.f.label) + '</span><span class="mk-mstate">' + (hasBid ? 'Bid placed' : 'No bid') + '</span></li>';
      }).join('') + '</ul>';
      if (combo.picked.length > 1) {
        b += '<div class="mk-combo"><p class="mk-label">Best combination</p><p>' + combo.picked.map(function (m) { return typeBadge(m.p.type) + '<span class="mk-pcode">' + esc(m.p.code) + '</span>'; }).join('<span class="mk-plus">+</span>') + '</p><p class="mk-dim">Together they use ' + fmt(combo.impUsed) + ' of ' + fmt(combo.cap.imp) + ' MW import' + (combo.expUsed ? ' and ' + fmt(combo.expUsed) + ' of ' + fmt(combo.cap.exp) + ' MW feed-in' : '') + '.</p></div>';
      }
    } else b += '<p class="mk-dim">No registered project fits this site yet.</p>';
    b += '</section>';
    if (mine(l)) {
      var pv = state.privSites[l.key] || {};
      b += '<section class="mk-dsec mk-private"><p class="mk-label">Private · only you and Capflex see this</p><p><b>' + esc(pv.company || '—') + '</b><br>' + esc(pv.address || '') + '<br>' + esc(pv.contact || '') + '</p></section>';
    }
    $('#mk-d-body').innerHTML = b;
    if (!keepForm) $('#mk-d-bid').innerHTML = bidForm(l);
    updateBidPreview(l);
  }
  function capBar(c, alloc) {
    var total = Math.max(c.conn, c.peak, 0.001);
    function pct(x) { return 'flex:' + Math.max(0, x / total).toFixed(4) + ' 1 0'; }
    var segs = '<i class="s-load" style="' + pct(Math.max(0, c.peak - c.flex)) + '"></i>', used = 0;
    alloc.rows.filter(function (r) { return r.allocated && T(r.p.type).pool !== 'export'; }).forEach(function (r) {
      var w = Math.min(n(r.p.mw), c.imp - used); if (w <= 0) return; used += w;
      segs += '<i class="s-alloc" style="' + pct(w) + '" title="' + esc(r.p.code) + ', ' + size(r.p) + '"></i>';
    });
    var flexFree = Math.max(0, c.flex - Math.max(0, used - c.firm)), firmFree = Math.max(0, c.firm - Math.min(used, c.firm));
    if (firmFree > 0) segs += '<i class="s-free" style="' + pct(firmFree) + '"></i>';
    if (flexFree > 0) segs += '<i class="s-flex" style="' + pct(flexFree) + '"></i>';
    return '<div class="mk-capwrap"><div class="mk-caphead"><span class="mk-label">Grid connection · ' + fmt(c.conn) + ' MW</span><span class="mk-dim">Factory peak ' + fmt(c.peak) + ' MW</span></div>' +
      '<div class="mk-capbar" role="img" aria-label="Connection of ' + fmt(c.conn) + ' MW: factory load, capacity allocated to leading bids, and capacity still free.">' + segs + '</div>' +
      '<div class="mk-legend"><span><i class="s-load"></i>Factory load</span><span><i class="s-alloc"></i>Allocated to leading bids</span><span><i class="s-free"></i>Free, firm</span><span><i class="s-flex"></i>Free with flexible load</span></div></div>';
  }
  function bidForm(l) {
    var head = '<section class="mk-dsec mk-bid">';
    if (!isOpen(l)) return head + '<p class="mk-label">Bidding closed</p><p class="mk-dim">This auction has ended. Capflex contacts the developers in the allocation.</p></section>';
    if (mine(l)) return head + '<p class="mk-label">Your listing</p><p class="mk-dim">Developers bid on your capacity here. You see every bid as it comes in; nobody sees your company or address.</p></section>';
    if (!state.me) return head + '<p class="mk-label">Place a bid</p><p class="mk-dim">Sign in with your email to register a project and bid. Your company stays private.</p><div class="mk-bidacts"><button class="btn btn-dark" type="button" data-action="signin">Sign in</button></div></section>';
    var mineFit = state.projects.filter(mine).map(function (p) { return { p: p, f: fit(l, p) }; }).filter(function (m) { return m.f.ok; });
    if (!mineFit.length) return head + '<p class="mk-label">Place a bid</p><p class="mk-dim">' + (state.projects.some(mine) ? 'None of your projects fits this site.' : 'Register a project to bid on this site.') + '</p><div class="mk-bidacts"><button class="btn btn-dark" type="button" data-action="new-project">Register a project</button></div></section>';
    var pid = state.bid.projectId && mineFit.some(function (m) { return m.p.id === state.bid.projectId; }) ? state.bid.projectId : mineFit[0].p.id;
    state.bid.projectId = pid;
    var existing = myBid(pid, l.id), min = n(l.reservePerMW);
    var val = state.bid.perMW !== '' ? state.bid.perMW : (existing ? n(existing.perMW) : Math.max(min, topBid(l.id) + 500));
    state.bid.perMW = String(val);
    var h = head + '<form id="mk-bidform" novalidate><p class="mk-label">' + (existing ? 'Update your bid' : 'Place a bid') + '</p><div class="mk-bidgrid">';
    h += '<label class="mk-field"><span>Project</span><select id="mk-bid-project">' + mineFit.map(function (m) { return '<option value="' + esc(m.p.id) + '"' + (m.p.id === pid ? ' selected' : '') + '>' + esc(m.p.code) + ' · ' + esc(T(m.p.type).label) + ' · ' + size(m.p) + ' · fit ' + m.f.score + '</option>'; }).join('') + '</select></label>';
    h += '<label class="mk-field"><span>Fee to Capflex</span><span class="mk-money"><input id="mk-bid-amount" type="number" inputmode="numeric" min="' + min + '" step="' + BID_STEP + '" value="' + esc(val) + '" aria-describedby="mk-bid-hint"><em>€/MW</em></span></label></div>';
    h += '<small class="mk-hint" id="mk-bid-hint">Minimum ' + money(min) + ' per MW, in steps of €' + BID_STEP + '.</small>';
    h += '<output class="mk-preview" id="mk-bid-preview" for="mk-bid-amount mk-bid-project"></output>';
    h += '<div class="mk-bidacts"><button class="btn btn-primary" type="submit" id="mk-bid-submit">' + (existing ? 'Update bid' : 'Place bid') + '</button>' + (existing ? '<button class="btn btn-quiet" type="button" data-action="withdraw" data-id="' + esc(existing.key) + '">Withdraw</button>' : '') + '</div>';
    h += '<p class="mk-terms">You pay the fee to Capflex only if the site signs with you. The highest € per MW gets first right to sign; capacity goes to bids in rank order until it runs out.</p>';
    return h + '</form></section>';
  }
  function updateBidPreview(l) {
    var out = $('#mk-bid-preview'); if (!out || !l) return;
    var p = proj(state.bid.projectId), per = Math.round(n(state.bid.perMW) / BID_STEP) * BID_STEP;
    if (!p) { out.textContent = ''; return; }
    if (per < n(l.reservePerMW)) { out.innerHTML = '<span class="mk-st wait">Below the minimum</span><span>Raise it to at least ' + money(n(l.reservePerMW)) + ' per MW.</span>'; return; }
    var others = bidsFor(l.id).filter(function (b) { return b.projectId !== p.id; });
    var me = { id: 'preview', listingId: l.id, projectId: p.id, perMW: per, placedAt: state.now + 1 };
    var all = others.concat([me]).sort(function (a, b) { return n(b.perMW) - n(a.perMW) || n(a.placedAt) - n(b.placedAt); });
    var row = allocate(l, all).rows.filter(function (r) { return r.bid.id === 'preview'; })[0];
    out.innerHTML = '<span><b>' + money(per * n(p.mw)) + '</b> total for ' + size(p) + '</span><span>Rank <b>#' + row.rank + '</b> of ' + all.length + '</span>' + (row.allocated ? '<span class="mk-st in">In allocation</span>' : '<span class="mk-st wait">Waiting for capacity</span>');
  }

  /* ---------- my projects ---------- */
  function viewProjects() {
    var list = state.projects.filter(mine).sort(function (a, b) { return n(b.createdAt) - n(a.createdAt); });
    var h = '<div class="mk-head"><div><h2 class="mk-title">My projects.</h2><p class="mk-sub">In the marketplace your projects show a code, a type and a size. Never your company.</p></div>' + (state.canWrite ? '<button class="btn btn-dark" type="button" data-action="new-project">Register a project</button>' : '') + '</div>';
    if (!loaded()) return h + '<p class="loading">Loading…</p>';
    if (!list.length) return h + '<div class="mk-empty-line">No projects yet. Register a battery, solar park, data centre or any other grid-connected project to see the industrial sites it fits.</div>';
    h += '<div class="mk-tablewrap"><table class="mk-table"><thead><tr><th>Project</th><th class="r">Size</th><th>Where</th><th>Start</th><th class="r">Fitting sites</th><th>Your bids</th><th></th></tr></thead><tbody>';
    list.forEach(function (p) {
      var fits = state.listings.filter(function (l) { return isOpen(l) && fit(l, p).ok; });
      var status = state.bids.filter(function (b) { return mine(b) && b.projectId === p.id; }).map(function (b) {
        var l = listing(b.listingId); if (!l) return '';
        var r = allocate(l, bidsFor(l.id)).rows.filter(function (x) { return x.bid.id === b.id; })[0];
        return '<button class="mk-chiplink" type="button" data-action="open" data-id="' + esc(l.id) + '">' + esc(l.code) + ' · ' + money(n(b.perMW)) + ' · #' + (r ? r.rank : '–') + (r && r.allocated ? ' <span class="mk-st in">In</span>' : ' <span class="mk-st wait">Waiting</span>') + '</button>';
      }).join('');
      var pv = state.privProjects[p.key];
      h += '<tr class="static"><td>' + typeBadge(p.type) + '<span class="mk-pcode">' + esc(p.code) + '</span><span class="mk-place">' + esc(T(p.type).label) + (pv && pv.company ? ' · ' + esc(pv.company) : '') + '</span></td>';
      h += '<td class="r"><span class="mk-mw">' + fmt(n(p.mw)) + '<small>' + esc(T(p.type).unit) + '</small></span>' + (p.type === 'battery' && n(p.mwh) ? '<span class="mk-place">' + fmt(n(p.mwh)) + ' MWh</span>' : '') + '</td>';
      h += '<td>' + esc(COUNTRIES[p.country] || p.country) + '<span class="mk-place">' + esc(p.regions && p.regions.length ? p.regions.map(function (r) { return regionName(p.country, r); }).join(', ') : 'Any region') + '</span></td>';
      h += '<td>' + esc(mon(p.cod)) + '</td>';
      h += '<td class="r"><button class="mk-chiplink strong" type="button" data-action="show-matches" data-id="' + esc(p.id) + '">' + fits.length + ' site' + (fits.length === 1 ? '' : 's') + '</button></td>';
      h += '<td><span class="mk-chips">' + (status || '<span class="mk-dim">No bids</span>') + '</span></td>';
      h += '<td class="r mk-rowacts">' + (state.confirm === 'p:' + p.id ? confirmRow('p:' + p.id, 'Delete this project and its bids?') : '<button class="btn btn-small btn-quiet" type="button" data-action="edit-project" data-id="' + esc(p.id) + '">Edit</button><button class="btn btn-small btn-quiet btn-danger" type="button" data-action="ask" data-key="p:' + esc(p.id) + '">Delete</button>') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  /* ---------- who is behind a site, and where (only for the lister and Capflex) ---------- */
  function factory() {
    var own = state.listings.filter(mine);
    if (own.length) return { sites: own, demo: false, company: (state.privSites[own[0].key] || {}).company || '' };
    var sites = state.listings.filter(function (l) { return l.ownerId === 'demo~factory1'; });
    if (sites.length) return { sites: sites, demo: true, company: (state.privSites[sites[0].id] || {}).company || 'Demo factory' };
    return { sites: [], demo: false, company: '' };
  }
  function privOf(l) {
    // Row level security only returns your own rows, the demo factory's and, for Capflex, every row.
    return state.privSites[l.id] || null;
  }
  function locOf(l, exact) {
    var pv = exact ? privOf(l) : null;
    if (pv && pv.lat !== '' && pv.lat != null && isFinite(parseFloat(pv.lat)) && isFinite(parseFloat(pv.lng))) return { lat: +pv.lat, lng: +pv.lng, exact: true };
    var c = CENTER[l.country + ':' + l.region];
    return c ? { lat: c[0], lng: c[1], exact: false } : null;
  }

  /* ---------- industry view: my sites ---------- */
  function viewListings() {
    var fs = factory();
    var h = '<div class="mk-head"><div><h2 class="mk-title">My sites.</h2><p class="mk-sub">The grid capacity you offer and who wants it. Developers see a code, the region, the capacity and the space. Never your company or address.</p></div>' + (state.canWrite ? '<button class="btn btn-dark" type="button" data-action="new-site">Offer capacity</button>' : '') + '</div>';
    if (!loaded()) return h + '<p class="loading">Loading…</p>';
    if (!fs.sites.length) return h + '<div class="mk-empty-line">You have not listed an industrial site yet. Offer the grid capacity your factory doesn\'t use: developers bid for it, and only Capflex learns who you are.</div>';
    if (fs.demo) h += '<div class="mk-banner"><span class="mk-demo">Demo</span><span>You are seeing Site Match as <b>' + esc(fs.company) + '</b>, a factory with ' + fs.sites.length + ' sites. This is a demo factory: on a real account you see your own sites here.</span></div>';
    else if (fs.company) h += '<div class="mk-banner"><span class="mk-own">Private</span><span><b>' + esc(fs.company) + '</b> · only you and Capflex see your name and locations.</span></div>';
    h += '<div class="mk-mapbox mk-mapbox-f"><div id="mk-map-slot" class="mk-map-slot short"></div><div class="mk-maplegend"><span class="mk-lg"><i class="pin"></i>Your site</span><span class="mk-lg"><i class="dot"></i>Nearest substation</span><span class="mk-lg"><i class="ln l380"></i>380 kV</span><span class="mk-lg"><i class="ln l220"></i>220 kV</span><span class="mk-lg"><i class="ln l150"></i>150 kV</span></div></div>';
    return h + fs.sites.map(siteCard).join('');
  }
  function siteCard(l) {
    var c = cap(l), pv = privOf(l) || {}, p = locOf(l, true), nr = p && p.exact && window.CapflexMap ? CapflexMap.nearest(p.lat, p.lng) : null;
    var alloc = allocate(l, bidsFor(l.id)), ms = matchesFor(l), req = alloc.rows.reduce(function (a, r) { return a + n(r.p.mw); }, 0);
    var h = '<article class="mk-site"><div class="mk-site-head"><div><p class="mk-label">Industrial site · what developers see</p><h3><button class="mk-code mk-code-big" type="button" data-action="open" data-id="' + esc(l.id) + '">' + esc(l.code) + '</button></h3><p class="mk-dplace">' + esc(place(l)) + ' · ' + esc(gridArea(l.country, l.region)) + ' area · ' + esc(l.voltage) + '</p></div>';
    h += '<div class="mk-site-acts">' + closesCell(l) + '<button class="btn btn-small" type="button" data-action="open" data-id="' + esc(l.id) + '">See it as developers do</button>' + (mine(l) ? '<button class="btn btn-small btn-quiet" type="button" data-action="edit-site" data-id="' + esc(l.id) + '">Edit</button>' : '') + '</div></div>';
    h += '<div class="mk-site-grid">';
    // location, private
    h += '<section><p class="mk-label">Location · private</p><p class="mk-strong">' + esc(pv.address || pv.town || '—') + '</p>';
    if (p && p.exact) h += '<p class="mk-coord">' + p.lat.toFixed(4) + ' N, ' + p.lng.toFixed(4) + ' E</p>';
    else h += '<p class="mk-dim">Add the exact location to see the nearest substation.</p>';
    if (nr && nr.sub) h += '<dl class="mk-facts2"><div><dt>Nearest substation</dt><dd>' + esc(nr.sub.name) + '<span>' + esc(nr.sub.kv + ' kV') + (nr.sub.op ? ' · ' + esc(nr.sub.op) : '') + ' · ' + fmt(nr.sub.km) + ' km</span></dd></div>' +
      (nr.line ? '<div><dt>Nearest 220/380 kV line</dt><dd>' + fmt(nr.line.km) + ' km<span>' + esc(nr.line.kv + ' kV') + (nr.line.op ? ' · ' + esc(nr.line.op) : '') + '</span></dd></div>' : '') + '</dl><p class="mk-src">Grid assets from OpenStreetMap. Check them with your grid operator.</p>';
    h += '</section>';
    // capacity
    h += '<section><p class="mk-label">Capacity on offer</p><div class="mk-big mk-big-2"><div><span class="mk-label">Free import</span><b>' + fmt(c.imp) + '<small>MW</small></b><span>' + fmt(c.firm) + ' firm + ' + fmt(c.flex) + ' flexible</span></div><div><span class="mk-label">Feed-in</span><b>' + fmt(c.exp) + '<small>MW</small></b><span>' + fmt(n(l.areaM2), 0) + ' m² free</span></div></div>' + capBar(c, alloc) + '</section>';
    // demand
    h += '<section><p class="mk-label">Demand</p><p class="mk-strong">' + alloc.rows.length + ' bid' + (alloc.rows.length === 1 ? '' : 's') + ' · ' + fmt(req) + ' MW requested</p><p class="mk-dim">' + ms.length + ' matching project' + (ms.length === 1 ? '' : 's') + ' in the marketplace.</p>';
    if (alloc.rows.length) h += '<ul class="mk-mlist">' + alloc.rows.slice(0, 4).map(function (r) { return '<li>' + typeBadge(r.p.type) + '<span class="mk-msize">' + size(r.p) + '</span><span class="mk-fitchip"><b>' + money(n(r.bid.perMW)) + '</b>/MW</span>' + (r.allocated ? '<span class="mk-st in">In</span>' : '<span class="mk-st wait">Waiting</span>') + '</li>'; }).join('') + '</ul>';
    h += '</section></div></article>';
    return h;
  }

  /* ---------- grid map ---------- */
  function viewMap() {
    var sig = SIGNALS[state.signal];
    var h = '<div class="mk-head"><div><h2 class="mk-title">Grid map.</h2><p class="mk-sub">The high-voltage grid from OpenStreetMap, where the German grid is congested according to the Bundesnetzagentur, and the industrial sites in Site Match.</p></div></div>';
    h += '<div class="mk-mapgrid"><div class="mk-mapbox"><div id="mk-map-slot" class="mk-map-slot"></div>' + mapLegend() + '</div><aside class="mk-mappanel">' + signalPanel(sig) + sitePanel() + '</aside></div>';
    return h + nextSection();
  }
  function mapLegend() {
    var h = '<div class="mk-maplegend"><span class="mk-lg"><i class="ln l380"></i>380 kV</span><span class="mk-lg"><i class="ln l220"></i>220 kV</span><span class="mk-lg"><i class="ln l150"></i>150 kV</span><span class="mk-lg"><i class="dot"></i>Substation, zoom in</span>';
    if (state.role === 'capflex') h += '<span class="mk-lg"><i class="pin"></i>Site, exact location</span>';
    else if (state.role === 'industry') h += '<span class="mk-lg"><i class="pin"></i>Your site</span><span class="mk-lg"><i class="bub"></i>Other sites, by region</span>';
    else h += '<span class="mk-lg"><i class="bub"></i>Industrial sites, by region</span>';
    return h + '</div>';
  }
  function signalPanel(sig) {
    var h = '<section class="mk-psec"><p class="mk-label">Grid congestion</p><div class="mk-seg mk-seg-wrap" role="group" aria-label="Congestion signal">' + Object.keys(SIGNALS).concat(['none']).map(function (k) {
      return '<button type="button" data-action="signal" data-v="' + k + '" aria-pressed="' + ((state.signal || 'none') === k) + '">' + esc(k === 'none' ? 'Off' : SIGNALS[k].tab) + '</button>';
    }).join('') + '</div>';
    if (!sig) return h + '<p class="mk-dim">Pick a signal to shade each German state by how congested its grid was.</p></section>';
    var rows = Object.keys(sig.data).map(function (k) { return [k, sig.data[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6), max = rows[0][1] || 1;
    h += '<h3 class="mk-ptitle">' + esc(sig.title) + '</h3><p class="mk-pkind"><b>' + esc(sig.kind) + '.</b> ' + esc(sig.meaning) + '</p>';
    h += '<ol class="mk-ranklist">' + rows.map(function (r) { return '<li><span>' + esc(regionName('DE', r[0])) + '</span><i><b style="width:' + (r[1] / max * 100).toFixed(1) + '%;background:' + sig.color + '"></b></i><em>' + fmt(r[1], 0) + ' GWh</em></li>'; }).join('') + '</ol>';
    h += '<p class="mk-pfit">' + esc(sig.fits) + '</p>';
    return h + '<p class="mk-src">Source: <a href="' + esc(sig.src[1]) + '" target="_blank" rel="noopener">' + esc(sig.src[0]) + '</a>. Germany only, by federal state.</p></section>';
  }
  function sitePanel() {
    var h = '<section class="mk-psec">';
    if (state.role === 'capflex') h += '<p class="mk-label">All sites · Capflex only</p><p class="mk-dim">Every listed site at its exact location. Developers never see this layer.</p>';
    else if (state.role === 'industry') h += '<p class="mk-label">Industrial sites</p><p class="mk-dim">You see your own sites at their exact location. Everyone else\'s appear by region only.</p>';
    else h += '<p class="mk-label">Industrial sites</p><p class="mk-dim">Shown by region only. Exact locations stay private until a site signs. Click a region to see its sites.</p>';
    if (state.mapRegion) {
      var p = state.mapRegion.split(':'), ls = state.listings.filter(function (l) { return isOpen(l) && l.country === p[0] && l.region === p[1]; });
      h += '<div class="mk-regionlist"><p class="mk-strong">' + esc(regionName(p[0], p[1])) + '</p>' + ls.map(function (l) { return '<button type="button" class="mk-chiplink" data-action="open" data-id="' + esc(l.id) + '">' + esc(l.code) + ' · ' + fmt(cap(l).imp) + ' MW</button>'; }).join('') + '</div>';
    }
    return h + '</section>';
  }
  function nextSection() {
    var h = '<section class="mk-next"><div class="mk-head"><div><p class="mk-label">Roadmap</p><h2 class="mk-title">Where Capflex goes next.</h2><p class="mk-sub">Today we unlock capacity inside factory connections. The same data shows where the grid is congested, and that is where large projects need capacity most.</p></div></div>';
    h += '<ol class="mk-steps mk-steps-3">' +
      '<li><span>01 · Today</span><h3>Behind the meter</h3><p>Spare capacity inside existing factory connections, matched to energy projects. Live in Site Match.</p></li>' +
      '<li><span>02 · Next</span><h3>Congestion intelligence</h3><p>Score every substation with public data: curtailment and redispatch, published connection capacity, connection queues and the load data from our sites.</p></li>' +
      '<li><span>03 · Then</span><h3>In front of the meter</h3><p>Offer grid capacity at congested substations to large players, such as big batteries, data centres and electrolysers, with flexible connection agreements from the grid operator.</p></li></ol>';
    h += '<p class="mk-label mk-gap">Already happening elsewhere</p><div class="mk-rulegrid">' +
      '<div><p class="mk-strong">United States</p><p>58 utilities and state agencies in 26 states publish hosting capacity maps that show where the distribution grid can take new generation or load. <a href="https://www.energy.gov/eere/us-atlas-electric-distribution-system-hosting-capacity-maps" target="_blank" rel="noopener">US Department of Energy, May 2024</a></p></div>' +
      '<div><p class="mk-strong">Great Britain</p><p>Connection data is published in registers such as the Embedded Capacity Register. Ofgem is consulting on a new Demand Capacity Register for demand connections. <a href="https://www.ofgem.gov.uk/sites/default/files/2026-09/transforming-connections-data.pdf" target="_blank" rel="noopener">Ofgem, September 2026</a></p></div>' +
      '<div><p class="mk-strong">Germany</p><p>The Netzanschlusspaket, adopted by the cabinet on 29 July 2026 and now in parliament, would make grid operators publish free connection capacity online and let them declare capacity-limited areas where over 5% of feed-in was curtailed. <a href="https://www.gleisslutz.com/de/know-how/das-netzanschlusspaket" target="_blank" rel="noopener">Gleiss Lutz summary</a></p></div></div>';
    return h + '<p class="mk-claim">The data is becoming public. Capflex turns it into sites you can connect to.</p></section>';
  }
  function mapData() {
    var role = state.role, items = [], links = [], fit = [];
    if (state.view === 'listings') {
      factory().sites.forEach(function (l) {
        var p = locOf(l, true); if (!p) return;
        items.push({ id: l.id, kind: p.exact ? 'own' : 'own approx', lat: p.lat, lng: p.lng, label: l.code, tip: '<b>' + esc(l.code) + '</b>' + (p.exact ? '' : '<br>Region centre until you add the exact location') });
        fit.push([p.lat, p.lng]);
        var nr = p.exact ? CapflexMap.nearest(p.lat, p.lng) : null;
        if (nr && nr.sub) {
          items.push({ id: 'sub:' + l.id, kind: 'sub', lat: nr.sub.lat, lng: nr.sub.lng, label: nr.sub.kv + ' kV', tip: esc(nr.sub.name) + '<br>' + esc(nr.sub.kv + ' kV') + ' · ' + fmt(nr.sub.km) + ' km' });
          links.push([[p.lat, p.lng], [nr.sub.lat, nr.sub.lng]]);
          fit.push([nr.sub.lat, nr.sub.lng]);
        }
      });
      return { items: items, links: links, fit: fit, maxZoom: fit.length > 2 ? 9 : 11, signal: null, key: 'f:' + factory().sites.map(function (l) { return l.id; }).join(',') };
    }
    var open = state.listings.filter(isOpen);
    if (role === 'capflex') {
      open.forEach(function (l) { var p = locOf(l, true); if (p) items.push({ id: l.id, kind: p.exact ? 'pin' : 'pin approx', lat: p.lat, lng: p.lng, label: l.code, tip: '<b>' + esc(l.code) + '</b>' + ((privOf(l) || {}).company ? '<br>' + esc(privOf(l).company) : '') + '<br>' + fmt(cap(l).imp) + ' MW free' + (p.exact ? '' : ' · region centre') }); });
    } else {
      var own = role === 'industry' ? factory().sites : [], ownIds = own.map(function (l) { return l.id; }), groups = {};
      own.forEach(function (l) { var p = locOf(l, true); if (p) items.push({ id: l.id, kind: 'own', lat: p.lat, lng: p.lng, label: l.code, tip: '<b>' + esc(l.code) + '</b><br>Your site' }); });
      open.filter(function (l) { return ownIds.indexOf(l.id) < 0; }).forEach(function (l) { var k = l.country + ':' + l.region; (groups[k] = groups[k] || []).push(l); });
      Object.keys(groups).forEach(function (k) {
        var c = CENTER[k]; if (!c) return;
        var ls = groups[k], mw = ls.reduce(function (a, l) { return a + cap(l).imp; }, 0), p = k.split(':');
        items.push({ id: k, kind: 'region', region: k, lat: c[0], lng: c[1], label: String(ls.length), size: mw, tip: '<b>' + esc(regionName(p[0], p[1])) + '</b><br>' + ls.length + ' industrial site' + (ls.length === 1 ? '' : 's') + ' · ' + fmt(mw) + ' MW free' });
      });
    }
    var s = SIGNALS[state.signal];
    return { items: items, links: [], fit: null, signal: s ? { data: s.data, color: s.color, alphas: s.alphas, steps: SIG_STEPS, short: s.short } : null, key: 'g' };
  }
  var mapLoadedOnce = false, lastFit = '';
  function syncMap() {
    var slot = $('#mk-map-slot');
    if (!slot || !window.CapflexMap) return;
    CapflexMap.attach(slot).then(function (ok) {
      if (!ok || !document.body.contains(slot)) return;
      if (!mapLoadedOnce) { mapLoadedOnce = true; render(); return; }
      var d = mapData();
      CapflexMap.setSignal(d.signal);
      CapflexMap.setMarkers(d.items, d.links);
      if (d.key !== lastFit) { lastFit = d.key; CapflexMap.view(d.fit, d.maxZoom); }
    });
  }
  if (window.CapflexMap) CapflexMap.onClick = function (it) {
    if (it.kind === 'region') { state.mapRegion = it.region; render(); }
    else { state.sel = it.id; render(); }
  };
  function confirmRow(key, text) {
    return '<span class="mk-confirm">' + esc(text) + ' <button class="btn btn-small btn-dark" type="button" data-action="yes" data-key="' + esc(key) + '">Delete</button><button class="btn btn-small" type="button" data-action="no">Cancel</button></span>';
  }

  /* ---------- how the marketplace works ---------- */
  function viewRules() {
    var h = '<div class="mk-head"><div><h2 class="mk-title">How the marketplace works.</h2><p class="mk-sub">Four steps from spare capacity to a signed site. Nobody sees who is behind a listing or a project until the deal.</p></div></div>';
    h += '<ol class="mk-steps">' +
      '<li><span>01</span><h3>A factory offers capacity</h3><p>It shares the contracted connection, last year\'s peak, flexible load, the feed-in limit, free area and a minimum fee. Company and address stay private.</p></li>' +
      '<li><span>02</span><h3>Developers register projects</h3><p>Battery, solar, wind, data centre, electrolyser, charging hub or power-to-heat. Each project is matched against every industrial site.</p></li>' +
      '<li><span>03</span><h3>They bid for first right</h3><p>A bid is a one-off fee to Capflex in € per MW, paid only if the site signs. The highest € per MW ranks first.</p></li>' +
      '<li><span>04</span><h3>Capacity goes in bid order</h3><p>Projects get the capacity they need in rank order until it runs out: import for loads and batteries, firm capacity for data centres, feed-in for solar and wind.</p></li></ol>';
    h += '<div class="mk-rulegrid"><div><p class="mk-label">What developers see</p><p>A code such as DE-NI-482, the region and country, the transmission area, voltage level, free import and feed-in capacity, free area and when it is available.</p></div>' +
      '<div><p class="mk-label">What stays private</p><p>Company name, address and contact details. Only the lister and Capflex can read them.</p></div>' +
      '<div><p class="mk-label">The grid operator</p><p>Every project stays within the site\'s contracted capacity, and the grid operator is notified before it goes live.</p></div></div>';
    return h;
  }

  /* ---------- Capflex desk (owner only): who is behind each code ---------- */
  function viewDesk() {
    if (!state.isOwner) return '<div class="mk-empty-line">Only Capflex can open the desk.</div>';
    var h = '<div class="mk-head"><div><h2 class="mk-title">Capflex desk.</h2><p class="mk-sub">Who is behind each code. Only Capflex sees this page.</p></div></div>';
    h += '<div class="mk-tablewrap"><table class="mk-table"><thead><tr><th>Industrial site</th><th>Company</th><th>Address</th><th>Contact</th><th class="r">Bids</th><th>First right</th></tr></thead><tbody>';
    state.listings.forEach(function (l) {
      var pv = state.privSites[l.id] || null, bids = bidsFor(l.id), lead = bids.length ? proj(bids[0].projectId) : null;
      h += '<tr data-action="open" data-id="' + esc(l.id) + '"><td><span class="mk-pcode">' + esc(l.code) + '</span><span class="mk-place">' + esc(place(l)) + '</span></td>';
      h += '<td>' + esc(pv && pv.company || '—') + '</td><td>' + esc(pv && pv.address || '—') + '</td><td>' + esc(pv && pv.contact || '—') + '</td>';
      h += '<td class="r">' + bids.length + '</td><td>' + (lead ? typeBadge(lead.type) + '<span class="mk-pcode">' + esc(lead.code) + '</span> · ' + money(n(bids[0].perMW)) + '/MW' : '—') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="mk-tablewrap"><table class="mk-table"><thead><tr><th>Project</th><th>Company</th><th>Contact</th><th class="r">Size</th></tr></thead><tbody>';
    state.projects.forEach(function (p) {
      var pv = state.privProjects[p.id] || null;
      h += '<tr class="static"><td>' + typeBadge(p.type) + '<span class="mk-pcode">' + esc(p.code) + '</span></td>';
      if (p.sample) h += '<td colspan="2"><span class="mk-dim">Demo project</span></td>';
      else h += '<td>' + esc(pv && pv.company || '—') + '</td><td>' + esc(pv && pv.contact || '—') + '</td>';
      h += '<td class="r">' + size(p) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  /* ---------- render ---------- */
  function render() {
    renderHead();
    var view = $('#view'); if (!view) return;
    var views = { matches: viewMatches, map: viewMap, projects: viewProjects, listings: viewListings, rules: viewRules, desk: viewDesk };
    var activeId = document.activeElement && document.activeElement.id;
    view.innerHTML = '<div class="mk">' + (views[state.view] || viewMatches)() + '</div>';
    if (activeId && activeId.indexOf('mk-f-') === 0) { var el = document.getElementById(activeId); if (el) el.focus(); }
    renderDrawer();
    syncMap();
  }

  /* ---------- routing ---------- */
  var VIEWS = ['matches', 'map', 'projects', 'listings', 'rules', 'desk'];
  function roleFor(v) {
    if (ROLES[state.role] && ROLES[state.role].tabs.indexOf(v) >= 0) return state.role;
    if (v === 'listings') return 'industry';
    if (v === 'desk' && state.isOwner) return 'capflex';
    return 'developer';
  }
  function route() {
    var v = (location.hash || '').slice(1);
    // The main navigation always points at #matches; a factory lands on its own sites instead.
    if (v === 'matches' && state.role === 'industry') { v = 'listings'; try { history.replaceState(null, '', '#listings'); } catch (e) {} }
    if (VIEWS.indexOf(v) >= 0) { state.view = v; var r = roleFor(v); if (r !== state.role) { state.role = r; saveRole(r); } }
    else state.sel = null;
    state.confirm = null; state.mapRegion = null; lastFit = '';
    render();
  }
  window.addEventListener('hashchange', route);

  /* ---------- form: offer capacity ---------- */
  function fillSelect(sel, opts, value) { sel.innerHTML = opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  var countryOpts = Object.keys(COUNTRIES).map(function (k) { return [k, COUNTRIES[k]]; });
  function siteLive() {
    var c = cap({ connectionMW: $('#ms-conn').value, peakMW: $('#ms-peak').value, flexMW: $('#ms-flex').value, feedInMW: $('#ms-feed').value });
    var out = $('#ms-live');
    if (!c.conn) { out.textContent = 'Enter the connection and peak load to see what developers can bid on.'; return; }
    out.innerHTML = 'Developers can bid on <b>' + fmt(c.imp) + ' MW</b> of import (' + fmt(c.firm) + ' MW firm + ' + fmt(c.flex) + ' MW flexible) and <b>' + fmt(c.exp) + ' MW</b> of feed-in.' + (c.peak > c.conn ? '<br>Peak load is above the connection. Check the values.' : '');
  }
  function guardWrite() {
    if (!sb) { toast('The marketplace is offline right now.', true); return false; }
    if (!state.me) { openSignIn(); return false; }
    return true;
  }
  function openSite(id) {
    if (!guardWrite()) return;
    var l = id ? listing(id) : null, pv = (l && state.privSites[l.key]) || {};
    state.editing.site = l ? l.id : null;
    $('#ms-title').textContent = l ? 'Edit ' + l.code : 'Offer capacity';
    $('#ms-submit').textContent = l ? 'Save changes' : 'Publish listing';
    $('#ms-error').textContent = '';
    var country = l ? l.country : 'DE';
    fillSelect($('#ms-country'), countryOpts, country);
    fillSelect($('#ms-region'), REGIONS[country], l ? l.region : null);
    fillSelect($('#ms-voltage'), VOLTAGES.map(function (v) { return [v[0], v[0] + ' · ' + v[1]]; }), l ? l.voltage : 'MV');
    fillSelect($('#ms-days'), AUCTION_DAYS.map(function (d) { return [String(d), d + ' days']; }), '14');
    $('#ms-days').disabled = !!l;
    $('#ms-conn').value = l ? l.connectionMW : '';
    $('#ms-peak').value = l ? l.peakMW : '';
    $('#ms-flex').value = l ? (l.flexMW || 0) : 0;
    $('#ms-feed').value = l ? (l.feedInMW || 0) : 0;
    $('#ms-area').value = l ? l.areaM2 : '';
    $('#ms-from').value = l ? (l.availableFrom || '') : '';
    $('#ms-reserve').value = l ? l.reservePerMW : 5000;
    $('#ms-company').value = pv.company || '';
    $('#ms-address').value = pv.address || '';
    $('#ms-contact').value = pv.contact || '';
    $('#ms-lat').value = pv.lat != null ? pv.lat : '';
    $('#ms-lng').value = pv.lng != null ? pv.lng : '';
    siteLive();
    $('#dlg-offer').showModal();
  }
  function firstInvalid(form) { var els = $$('input,select,textarea', form); for (var i = 0; i < els.length; i++) if (!els[i].disabled && !els[i].checkValidity()) return els[i]; return null; }
  function submitSite(e) {
    e.preventDefault();
    var bad = firstInvalid(this); if (bad) { bad.reportValidity(); $('#ms-error').textContent = 'Fill in the highlighted field.'; return; }
    if (!/^\d{4}-\d{2}$/.test($('#ms-from').value)) { $('#ms-error').textContent = 'Enter the month as YYYY-MM.'; return; }
    var l = state.editing.site ? listing(state.editing.site) : null, key = l ? l.key : newKey('l');
    var country = $('#ms-country').value, region = $('#ms-region').value;
    var data = {
      country: country, region: region, voltage: $('#ms-voltage').value,
      connectionMW: n($('#ms-conn').value), peakMW: n($('#ms-peak').value), flexMW: n($('#ms-flex').value), feedInMW: n($('#ms-feed').value),
      areaM2: n($('#ms-area').value), availableFrom: $('#ms-from').value, reservePerMW: Math.max(0, Math.round(n($('#ms-reserve').value) / BID_STEP) * BID_STEP),
      code: l && l.country === country && l.region === region ? l.code : uniqueCode(country, region),
      createdAt: l ? n(l.createdAt) : Date.now(), closesAt: l ? n(l.closesAt) : Date.now() + n($('#ms-days').value) * DAY
    };
    var lat = $('#ms-lat').value, lng = $('#ms-lng').value;
    if ((lat === '') !== (lng === '')) { $('#ms-error').textContent = 'Enter both latitude and longitude, or neither.'; return; }
    var priv = { company: $('#ms-company').value.trim(), address: $('#ms-address').value.trim(), contact: $('#ms-contact').value.trim(), lat: lat === '' ? null : n(lat), lng: lng === '' ? null : n(lng) };
    var btn = $('#ms-submit'); btn.disabled = true;
    var row = { id: key, owner: state.me, code: data.code, country: data.country, region: data.region, voltage: data.voltage, connection_mw: data.connectionMW, peak_mw: data.peakMW,
      flex_mw: data.flexMW, feed_in_mw: data.feedInMW, area_m2: data.areaM2, available_from: data.availableFrom, reserve_per_mw: data.reservePerMW, closes_at: new Date(data.closesAt).toISOString() };
    var p = must(sb.from('listings').upsert(row)).then(function () { return must(sb.from('site_private').upsert({ listing_id: key, owner: state.me, company: priv.company, address: priv.address, contact: priv.contact, lat: priv.lat, lng: priv.lng })); });
    write(p, l ? 'Listing updated.' : 'Listing published as ' + data.code + '. Developers can bid now.').then(function (ok) {
      btn.disabled = false;
      if (!ok) { $('#ms-error').textContent = 'Could not save this listing. Try again.'; return; }
      $('#dlg-offer').close();
      if (!l) { state.sel = key; if (location.hash !== '#listings') location.hash = 'listings'; else render(); }
    });
  }
  function uniqueCode(country, region) {
    var code, tries = 0;
    do { code = country + '-' + region + '-' + rnd3(); tries++; } while (state.listings.some(function (x) { return x.code === code; }) && tries < 50);
    return code;
  }

  /* ---------- form: register a project ---------- */
  function projectLive() {
    var t = $('input[name="mp-type"]:checked'), type = t ? t.value : 'battery', TT = T(type), mw = n($('#mp-mw').value);
    $('#mp-unit').textContent = TT.unit;
    $('#mp-mwh-wrap').hidden = type !== 'battery';
    $('#mp-mwh').required = type === 'battery';
    $('#mp-area').placeholder = mw ? 'about ' + fmt(mw * TT.area, 0) : 'optional';
    $('#mp-live').innerHTML = 'Matched against each site\'s ' + esc(POOL_TEXT[TT.pool]) + '.' + (mw ? ' Typical space: about <b>' + fmt(mw * TT.area, 0) + ' m²</b> for ' + fmt(mw) + ' ' + TT.unit + '.' : '');
  }
  function checkboxes(container, name, opts, values, type) {
    container.innerHTML = opts.map(function (o) {
      var id = name + '-' + o[0].replace(/[^a-zA-Z0-9]/g, '');
      return '<label for="' + id + '"><input type="' + (type || 'checkbox') + '" id="' + id + '" name="' + name + '" value="' + esc(o[0]) + '"' + (values.indexOf(o[0]) >= 0 ? ' checked' : '') + '>' + o[1] + '</label>';
    }).join('');
  }
  function checked(name) { return $$('input[name="' + name + '"]:checked').map(function (i) { return i.value; }); }
  function openProject(id) {
    if (!guardWrite()) return;
    var p = id ? proj(id) : null, pv = (p && state.privProjects[p.key]) || {};
    state.editing.project = p ? p.id : null;
    $('#mp-title').textContent = p ? 'Edit ' + p.code : 'Register a project';
    $('#mp-submit').textContent = p ? 'Save changes' : 'Register project';
    $('#mp-error').textContent = '';
    checkboxes($('#mp-types'), 'mp-type', TYPE_ORDER.map(function (t) { return [t, esc(TYPES[t].label)]; }), [p ? p.type : 'battery'], 'radio');
    checkboxes($('#mp-volts'), 'mp-volt', VOLTAGES.map(function (v) { return [v[0], v[0] + ' · ' + v[1]]; }), p ? (p.voltages || []) : ['MV']);
    var country = p ? p.country : 'DE';
    fillSelect($('#mp-country'), countryOpts, country);
    var regs = p && p.regions ? p.regions : [];
    $('#mp-anyregion').checked = !regs.length;
    $('#mp-regions-wrap').hidden = !regs.length;
    checkboxes($('#mp-regions'), 'mp-region', (REGIONS[country] || []).map(function (r) { return [r[0], esc(r[1])]; }), regs);
    $('#mp-mw').value = p ? p.mw : '';
    $('#mp-mwh').value = p ? (p.mwh || '') : '';
    $('#mp-area').value = p && p.areaM2 ? p.areaM2 : '';
    $('#mp-cod').value = p ? (p.cod || '') : '';
    $('#mp-company').value = pv.company || '';
    $('#mp-contact').value = pv.contact || '';
    projectLive();
    $('#dlg-project').showModal();
  }
  function submitProject(e) {
    e.preventDefault();
    var bad = firstInvalid(this); if (bad) { bad.reportValidity(); $('#mp-error').textContent = 'Fill in the highlighted field.'; return; }
    if (!/^\d{4}-\d{2}$/.test($('#mp-cod').value)) { $('#mp-error').textContent = 'Enter the month as YYYY-MM.'; return; }
    var type = checked('mp-type')[0] || 'battery', volts = checked('mp-volt');
    if (!volts.length) { $('#mp-error').textContent = 'Pick at least one voltage level.'; return; }
    var regions = $('#mp-anyregion').checked ? [] : checked('mp-region');
    if (!$('#mp-anyregion').checked && !regions.length) { $('#mp-error').textContent = 'Pick regions, or tick "Any region".'; return; }
    var p = state.editing.project ? proj(state.editing.project) : null, key = p ? p.key : newKey('p');
    var data = {
      type: type, mw: n($('#mp-mw').value), mwh: type === 'battery' ? n($('#mp-mwh').value) : 0, areaM2: n($('#mp-area').value),
      voltages: volts, country: $('#mp-country').value, regions: regions, cod: $('#mp-cod').value,
      code: p && p.type === type ? p.code : T(type).short + '-' + rnd3(), createdAt: p ? n(p.createdAt) : Date.now()
    };
    var priv = { company: $('#mp-company').value.trim(), contact: $('#mp-contact').value.trim() };
    var btn = $('#mp-submit'); btn.disabled = true;
    var row = { id: key, owner: state.me, type: data.type, code: data.code, mw: data.mw, mwh: data.mwh, area_m2: data.areaM2, voltages: data.voltages, country: data.country, regions: data.regions, cod: data.cod };
    var pr = must(sb.from('projects').upsert(row)).then(function () { return must(sb.from('project_private').upsert({ project_id: key, owner: state.me, company: priv.company, contact: priv.contact })); });
    write(pr, p ? 'Project updated.' : 'Project ' + data.code + ' registered. These are the industrial sites it fits.').then(function (ok) {
      btn.disabled = false;
      if (!ok) { $('#mp-error').textContent = 'Could not save this project. Try again.'; return; }
      $('#dlg-project').close();
      if (!p) { state.filters.project = key; state.filters.type = 'all'; state.filters.sort = 'fit'; if (location.hash !== '#matches') location.hash = 'matches'; else render(); }
    });
  }

  /* ---------- bids ---------- */
  function submitBid(e) {
    e.preventDefault();
    var l = listing(state.sel), p = proj(state.bid.projectId);
    if (!l || !p || !mine(p)) return;
    var per = Math.round(n($('#mk-bid-amount').value) / BID_STEP) * BID_STEP;
    if (per < n(l.reservePerMW)) { toast('The minimum for this site is ' + money(n(l.reservePerMW)) + ' per MW.', true); return; }
    if (!isOpen(l)) { toast('This auction has closed.', true); return; }
    var existing = myBid(p.id, l.id), key = existing ? existing.id : newKey('b');
    var data = { listingId: l.id, projectId: p.id, perMW: per, createdAt: existing ? n(existing.createdAt) : Date.now(), placedAt: existing && n(existing.perMW) === per ? n(existing.placedAt) : Date.now() };
    var btn = $('#mk-bid-submit'); if (btn) btn.disabled = true;
    state.bid.perMW = String(per);
    var row = { id: key, owner: state.me, listing_id: data.listingId, project_id: data.projectId, per_mw: data.perMW, placed_at: new Date(data.placedAt).toISOString() };
    write(must(sb.from('bids').upsert(row)), (existing ? 'Bid updated to ' : 'Bid placed: ') + money(per) + ' per MW on ' + l.code + '.').then(function () {
      if (btn) btn.disabled = false;
      var box = $('#mk-d-bid'); if (box) { box.innerHTML = bidForm(l); updateBidPreview(l); }
    });
  }
  function withdraw(key) {
    write(must(sb.from('bids').delete().eq('id', key)), 'Bid withdrawn.').then(function () {
      var l = listing(state.sel); state.bid.perMW = '';
      var box = $('#mk-d-bid'); if (l && box) { box.innerHTML = bidForm(l); updateBidPreview(l); }
    });
  }
  function deleteListing(id) {
    var l = listing(id); if (!l || !mine(l)) return;
    var p = must(sb.from('listings').delete().eq('id', l.id));
    if (state.sel === id) state.sel = null;
    write(p, 'Listing deleted.');
  }
  function deleteProject(id) {
    var pr = proj(id); if (!pr || !mine(pr)) return;
    var p = must(sb.from('projects').delete().eq('id', pr.id));
    if (state.filters.project === id) { state.filters.project = 'all'; if (state.filters.sort === 'fit') state.filters.sort = 'free'; }
    write(p, 'Project deleted.');
  }
  function removeDemo() {
    var p = must(sb.from('listings').delete().eq('sample', true)).then(function () { return must(sb.from('projects').delete().eq('sample', true)); });
    state.sel = null;
    write(p, 'Demo data removed.');
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var a = t.getAttribute('data-action'), id = t.getAttribute('data-id');
    if (a === 'open') { if (e.target.closest('.mk-rowacts')) return; state.sel = id; render(); }
    else if (a === 'close') { state.sel = null; render(); }
    else if (a === 'f-type') { state.filters.type = t.getAttribute('data-v'); render(); }
    else if (a === 'role') {
      var r = t.getAttribute('data-v'); if (!ROLES[r]) return;
      state.role = r; saveRole(r); state.sel = null; lastFit = '';
      if (ROLES[r].tabs.indexOf(state.view) < 0) location.hash = ROLES[r].tabs[0]; else render();
    }
    else if (a === 'signal') { var sv = t.getAttribute('data-v'); state.signal = SIGNALS[sv] ? sv : null; render(); }
    else if (a === 'new-site') openSite(null);
    else if (a === 'new-project' || a === 'new-battery') openProject(null);
    else if (a === 'edit-site') openSite(id);
    else if (a === 'edit-project') openProject(id);
    else if (a === 'show-matches') { state.filters.project = id; state.filters.sort = 'fit'; state.filters.type = 'all'; if (location.hash !== '#matches') location.hash = 'matches'; else render(); }
    else if (a === 'withdraw') withdraw(id);
    else if (a === 'remove-demo') removeDemo();
    else if (a === 'signin') openSignIn();
    else if (a === 'signin-link') sendSignInLink();
    else if (a === 'password') { var dp = $('#dlg-pass'); if (dp) { $('#pw-msg').textContent = ''; $('#pw-error').textContent = ''; dp.showModal(); } }
    else if (a === 'signout') { if (sb) sb.auth.signOut(); }
    else if (a === 'ask') { state.confirm = t.getAttribute('data-key'); render(); }
    else if (a === 'no') { state.confirm = null; render(); }
    else if (a === 'yes') { var k = t.getAttribute('data-key') || '', kind = k.slice(0, 1), rest = k.slice(2); state.confirm = null; if (kind === 'l') deleteListing(rest); else deleteProject(rest); render(); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'mk-f-country') { state.filters.country = t.value; render(); }
    else if (t.id === 'mk-f-project') { state.filters.project = t.value; if (t.value === 'all' && state.filters.sort === 'fit') state.filters.sort = 'free'; render(); }
    else if (t.id === 'mk-f-sort') { state.filters.sort = t.value; render(); }
    else if (t.id === 'mk-f-closed') { state.filters.closed = t.checked; render(); }
    else if (t.id === 'mk-bid-project') {
      state.bid.projectId = t.value;
      var ex = myBid(t.value, state.sel), l = listing(state.sel);
      state.bid.perMW = ex ? String(ex.perMW) : String(Math.max(n(l && l.reservePerMW), topBid(state.sel) + 500));
      var box = $('#mk-d-bid'); if (box && l) { box.innerHTML = bidForm(l); updateBidPreview(l); }
    }
    else if (t.id === 'ms-country') fillSelect($('#ms-region'), REGIONS[t.value], null);
    else if (t.id === 'mp-country') checkboxes($('#mp-regions'), 'mp-region', (REGIONS[t.value] || []).map(function (r) { return [r[0], esc(r[1])]; }), []);
    else if (t.id === 'mp-anyregion') $('#mp-regions-wrap').hidden = t.checked;
    else if (t.name === 'mp-type') projectLive();
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'mk-bid-amount') { state.bid.perMW = t.value; updateBidPreview(listing(state.sel)); }
    else if (/^ms-(conn|peak|flex|feed)$/.test(t.id)) siteLive();
    else if (t.id === 'mp-mw') projectLive();
  });
  document.addEventListener('submit', function (e) { if (e.target.id === 'mk-bidform') submitBid(e); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.sel && !document.querySelector('dialog[open]')) { state.sel = null; render(); } });
  var fo = $('#form-offer'); if (fo) fo.addEventListener('submit', submitSite);
  var fp = $('#form-project'); if (fp) fp.addEventListener('submit', submitProject);
  var fs = $('#form-signin'); if (fs) fs.addEventListener('submit', submitSignIn);
  var fw = $('#form-pass'); if (fw) fw.addEventListener('submit', submitPassword);
  $$('[data-close]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });

  // Keep countdowns current without re-rendering forms.
  setInterval(function () {
    state.now = Date.now();
    $$('[data-closes]').forEach(function (el) { var l = listing(el.getAttribute('data-closes')); if (l) el.textContent = timeLeft(closesAt(l)); });
  }, 30000);

  route();
  connect();
})();
