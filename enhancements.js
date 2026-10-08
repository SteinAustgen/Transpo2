/* Pampanga Transit Directory — standards enhancements.
   Loads after app.js. Existing app.js logic is unchanged; hooks wrap its functions. */
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s) => String(s ?? '').replace(/[<>"]/g, '').trim();
const LS = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
// Set to a Google Apps Script / Firebase URL so commuter reports reach a shared backend.
const REPORT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwJj9nQTcCG6Li6PTqPDlZ2ACKDo3oCxySdRac9oP6GikxYsnkruI9xU5sY5P0eDHdO/exec';

/* ── Data layer: published site-data.json, overridden by the admin's local draft ── */
const DEFAULTS = {
  fare: { discount: 20, updated: 'LTFRB matrix effective Sept 28, 2026', trad: { base: 14, baseKm: 4, perKm: 2 }, modern: { base: 17, baseKm: 4, perKm: 2.4 } },
  notices: [], routes: [], hidden: [], coords: {},
};
let DB = JSON.parse(JSON.stringify(DEFAULTS));
async function loadDB() {
  let src = LS.get('pt_data', null);
  if (!src) { try { const r = await fetch('site-data.json', { cache: 'no-cache' }); if (r.ok) src = await r.json(); } catch (e) {} }
  if (src) DB = { ...DEFAULTS, ...src, fare: { ...DEFAULTS.fare, ...(src.fare || {}) } };
}
const save = () => LS.set('pt_data', DB);

/* ── Route layer: merges admin routes / hides removed ones; fixes "[link removed]" links; caches last sync ── */
const keyOf = (r) => `${r.start}|${r.destination}`;
const goodLink = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const toRoute = (r) => {
  const t = String(r.type || '').toLowerCase(), reg = +r.regularFare || 0, stop = clean(r.stopovers);
  return {
    id: 'a:' + keyOf(r), admin: true, start: clean(r.start), destination: clean(r.destination),
    terminal: clean(r.terminal) || `${clean(r.start)} → ${clean(r.destination)}`, type: clean(r.type) || 'Traditional Jeepney',
    signboard: clean(r.signboard), tagClass: t.includes('modern') ? 'tag-modern' : /uv|bus/.test(t) ? 'tag-express' : 'tag-traditional',
    regularFare: reg, studentFare: +r.studentFare || +(reg * (1 - DB.fare.discount / 100)).toFixed(2),
    dropoff: clean(r.dropoff) + (stop ? ` Stopovers: ${stop}.` : ''), gmapLink: goodLink(r.gmapLink),
    landmarkName: clean(r.landmarkName) || clean(r.destination), landmarkDesc: clean(r.landmarkDesc) || clean(r.dropoff) || 'Alight at the destination terminal.',
    landmarkImg: formatDriveImageUrl(r.landmarkImg), lat: parseFloat(r.lat) || null, lon: parseFloat(r.lon) || null, stopovers: stop,
  };
};
let base = [], merged = null;
const _pop = window.populateDropdownOptions;
window.populateDropdownOptions = function () {
  const wasMe = $('start-select').value === '__me__';
  if (masterlist !== merged) base = masterlist.map((r) => ({ ...r, gmapLink: goodLink(r.gmapLink) }));
  masterlist = merged = base.filter((r) => !DB.hidden.includes(keyOf(r))).concat(DB.routes.map(toRoute));
  if ($('sync-dot').classList.contains('live') && base.length) LS.set('pt_cache', base);
  _pop();
  if (wasMe) { addMeOption(); $('start-select').value = '__me__'; }
};
function refresh() {
  populateDropdownOptions(); renderRouteCards(masterlist, 'all-routes-list');
  const s = $('start-select').value, d = $('dest-select').value;
  if (s && d) handleRouteState(s, d);
  fillReportRoutes();
}

/* ── Service announcements ── */
function renderNotices() {
  let el = $('pt-notices');
  if (!el) { el = document.createElement('div'); el.id = 'pt-notices'; document.querySelector('.header').after(el); el.onclick = (e) => { const x = e.target.dataset.x; if (x) { LS.set('pt_gone', LS.get('pt_gone', []).concat(x)); renderNotices(); } }; }
  const gone = LS.get('pt_gone', []), today = new Date().toISOString().slice(0, 10);
  el.innerHTML = DB.notices.filter((n) => !gone.includes(n.id) && (!n.until || n.until >= today))
    .map((n) => `<div class="pt-notice ${esc(n.level)}" role="status"><span>${esc(n.text)}</span><button data-x="${esc(n.id)}" aria-label="Dismiss">✕</button></div>`).join('');
}

/* ── Shared helpers: place coordinates (admin-published → device cache → one-time geocode) ── */
const ME = '__me__', BIG = 1e9, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const me = { on: false, ready: false, lat: 0, lon: 0, term: '', km: 0, sorted: [] };
const coords = LS.get('pt_coords', {});
const cd = (n) => coords[String(n).toLowerCase()];
const sv = () => ($('start-select').value === ME ? me.term : $('start-select').value);
const currentRoute = () => masterlist.find((r) => r.start === sv() && r.destination === $('dest-select').value);
async function coordOfName(n) {
  if (cd(n)) return cd(n);
  const c = await geocode(n);
  if (c) { coords[String(n).toLowerCase()] = c; LS.set('pt_coords', coords); }
  await sleep(1100); // Nominatim policy: max 1 request/second
  return c;
}
const originCoord = (r) => (r.lat && r.lon ? { lat: r.lat, lon: r.lon } : cd(r.start));
async function warm(places, msg) {
  const todo = [...new Set(places)].filter((p) => p && !cd(p));
  for (let i = 0; i < todo.length; i++) { msg.textContent = `Locating places… ${i + 1}/${todo.length} (one-time, then saved)`; await coordOfName(todo[i]); }
  msg.textContent = '';
}
const locate = () => new Promise((ok) => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => { me.lat = p.coords.latitude; me.lon = p.coords.longitude; ok(true); }, () => ok(false), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }) : ok(false));

/* ── Automatic fare: shown for every selected trip, nothing to type ── */
function calc() {
  const box = $('pt-fare'), r = currentRoute();
  if (!box || !r) return;
  const f = DB.fare, d = f.discount / 100, km = parseFloat(($('dist-value').textContent || '').replace(/[^0-9.]/g, '')) || 0;
  const t = /modern/i.test(r.type) ? 'modern' : /uv|bus/i.test(r.type) ? null : 'trad', c = t && f[t];
  const row = (n, v) => `<div><span>${n}</span><b>₱${v.toFixed(2)}</b></div>`;
  let reg = r.regularFare, head = 'Fare for this trip', foot = `Directory fare. Students, seniors and PWD get ${f.discount}% off.`;
  if (c && km) { reg = c.base + Math.ceil(Math.max(0, km - c.baseKm)) * c.perKm; head = `Estimated LTFRB fare <small>~${km.toFixed(1)} km</small>`; foot = `${esc(f.updated)}. Directory fare: ₱${r.regularFare.toFixed(2)} regular / ₱${r.studentFare.toFixed(2)} student. Distance is estimated; the fare posted in the vehicle prevails.`; }
  box.innerHTML = `<h4>${head}</h4><div class="pt-fares">${row('Regular', reg)}${row('Student', reg * (1 - d))}${row('Senior', reg * (1 - d))}${row('PWD', reg * (1 - d))}</div><p class="pt-hint">${foot}</p>`;
}

/* ── Near me: your location becomes the origin; nearest terminal serving your destination is used ── */
async function placeName(lat, lon) {
  const fb = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  try { const a = (await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${lat}&lon=${lon}`)).json()).address || {}; return [a.road, a.suburb || a.village || a.town || a.city].filter(Boolean).join(', ') || fb; } catch (e) { return fb; }
}
function addMeOption() {
  const s = $('start-select');
  if (!s.querySelector(`option[value="${ME}"]`)) s.options[0].after(new Option(me.label || '◎ My current location', ME));
}
async function nearMe() {
  const out = $('pt-near-out'); out.textContent = 'Getting your location…';
  if (!(await locate())) { out.textContent = 'Location unavailable. Please allow location access in your browser.'; return; }
  Object.assign(me, { on: true, ready: false, sorted: [], term: '', label: '◎ My current location' });
  addMeOption(); $('start-select').value = ME; onOriginChange();
  placeName(me.lat, me.lon).then((n) => { me.label = `◎ My location · ${n}`; const o = $('start-select').querySelector(`option[value="${ME}"]`); if (o) o.text = me.label; });
  const origins = [...new Map(masterlist.map((r) => [r.start, r])).values()];
  for (let i = 0; i < origins.length; i++) {
    out.textContent = `Finding terminals near you… ${i + 1}/${origins.length}`;
    if (!originCoord(origins[i])) await coordOfName(origins[i].start);
    const c = originCoord(origins[i]);
    if (c) { me.sorted.push({ name: origins[i].start, km: haversineKm(me.lat, me.lon, c.lat, c.lon) }); me.sorted.sort((a, b) => a.km - b.km); }
  }
  me.ready = true; out.textContent = 'Origin set to your location. Now choose your destination.';
  if ($('start-select').value === ME && $('dest-select').value) onDestinationChange();
}
const _udo = window.updateDestinationOptions;
window.updateDestinationOptions = (s, k) => _udo(s === ME ? '' : s, k);
const _hrs = window.handleRouteState;
window.handleRouteState = function (s, d) {
  const walk = $('pt-walk');
  if (s !== ME) { me.term = ''; if (walk) walk.hidden = true; _hrs(s, d); return calc(); }
  const title = $('empty-prompt-title'), desc = $('empty-prompt-desc');
  const near = d && me.sorted.find((t) => masterlist.some((r) => r.start === t.name && r.destination === d));
  if (near) {
    me.term = near.name; me.km = near.km; _hrs(near.name, d);
    walk.hidden = false; walk.textContent = `Nearest terminal to you: ${near.name}, about ${near.km.toFixed(1)} km away (straight line).`; return calc();
  }
  me.term = ''; walk.hidden = true; _hrs('', d || '');
  if (!d) { title.textContent = 'Origin: your current location'; desc.textContent = 'Choose your destination above. We will pick the nearest terminal that goes there.'; }
  else if (!me.ready) { title.textContent = 'Finding the nearest terminal…'; desc.textContent = 'This takes a moment the first time, then it is saved on your device.'; }
  else { title.textContent = 'No direct ride found'; desc.textContent = 'No terminal in the directory serves that destination from your area.'; }
};
const _om = window.openRouteMapModal;
window.openRouteMapModal = () => { const s = $('start-select'), v = s.value; if (v === ME) s.value = me.term; try { _om(); } finally { s.value = v; } };

/* ── Sort All Routes: A–Z, nearest to me, shortest trip, lowest fare ── */
function sortKey(m) {
  if (m === 'fare') return (r) => r.regularFare;
  if (m === 'near') return (r) => { const c = originCoord(r); return me.lat && c ? haversineKm(me.lat, me.lon, c.lat, c.lon) : BIG; };
  if (m === 'dist') return (r) => { const a = originCoord(r), b = cd(r.destination); return a && b ? haversineKm(a.lat, a.lon, b.lat, b.lon) : BIG; };
  return null;
}
const _rc = window.renderRouteCards;
window.renderRouteCards = function (data, id) {
  const m = id === 'all-routes-list' && $('pt-sort') ? $('pt-sort').value : 'az', key = sortKey(m);
  const list = key ? [...data].sort((a, b) => key(a) - key(b)) : data;
  _rc(list, id);
  if (key && m !== 'fare') [...$(id).children].forEach((c, i) => { const v = key(list[i]); if (c.querySelector && v < BIG) c.querySelector('.route-meta')?.insertAdjacentHTML('beforeend', `<span class="pt-dist">${v.toFixed(1)} km${m === 'near' ? ' from you' : ' trip'}</span>`); });
};

/* ── Live traffic + ETA (Google Maps JS API, key in config.js) ── */
let gm = null, liveMap = null, liveLine = null, liveT = 0, seq = 0;
const apiKey = () => ((window.PT_CONFIG || {}).GOOGLE_MAPS_API_KEY || '').trim();
window.gm_authFailure = () => { const e = $('pt-eta'); if (e) e.textContent = 'Live traffic is unavailable: the Google Maps API key was rejected. See ADMIN-GUIDE.md.'; };
function loadMaps() {
  if (!apiKey()) return Promise.resolve(null);
  gm = gm || new Promise((ok) => { window.__ptMaps = () => ok(google.maps); const s = document.createElement('script'); s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey())}&loading=async&callback=__ptMaps&v=weekly`; s.onerror = () => ok(null); document.head.appendChild(s); });
  return gm;
}
async function showLive(r) {
  const eta = $('pt-eta'), my = ++seq; clearTimeout(liveT);
  const maps = await loadMaps();
  if (!maps) { eta.textContent = 'Live traffic and ETA: tap "Google Maps" below for current conditions.'; return; }
  try {
    const { Route } = await maps.importLibrary('routes'), { Map: GMap, TrafficLayer } = await maps.importLibrary('maps');
    if (!liveMap) {
      $('gmap-frame').style.display = 'none';
      document.querySelector('.map-container').insertAdjacentHTML('beforeend', '<div id="pt-livemap" style="width:100%;height:100%;min-height:260px"></div>');
      liveMap = new GMap($('pt-livemap'), { center: { lat: 15.0794, lng: 120.62 }, zoom: 11, mapTypeControl: false, streetViewControl: false });
      new TrafficLayer().setMap(liveMap);
    }
    eta.textContent = 'Checking live traffic…';
    const q = (n) => `${n}, Pampanga, Philippines`;
    const { routes } = await Route.computeRoutes({ origin: q(r.start), destination: q(r.destination), travelMode: 'DRIVING', routingPreference: 'TRAFFIC_AWARE', departureTime: new Date(Date.now() + 60000), fields: ['durationMillis', 'staticDurationMillis', 'distanceMeters', 'path'] });
    if (my !== seq || !routes || !routes[0]) return;
    const R = routes[0], path = R.path.map((p) => ({ lat: p.lat, lng: p.lng })), b = new maps.LatLngBounds();
    path.forEach((p) => b.extend(p));
    if (liveLine) liveLine.setMap(null);
    liveLine = new maps.Polyline({ path, strokeColor: '#4f8cff', strokeWeight: 5, map: liveMap }); liveMap.fitBounds(b);
    const min = Math.round(R.durationMillis / 6e4), slow = Math.round((R.durationMillis - R.staticDurationMillis) / 6e4);
    eta.textContent = `Live ETA by road: ~${min} min (${(R.distanceMeters / 1000).toFixed(1)} km) · ${slow >= 3 ? `traffic adds ~${slow} min` : 'traffic is light'}. Updates every 5 min. Jeepney times vary with stops.`;
    liveT = setTimeout(() => showLive(r), 3e5);
  } catch (e) { eta.textContent = 'Live traffic could not be loaded right now. Tap "Google Maps" below instead.'; }
}
const _urd = window.updateRouteDetails;
window.updateRouteDetails = (r) => { _urd(r); showLive(r); };

/* ── Report a correction (own tab) ── */
function fillReportRoutes() {
  const s = $('pt-rroute'); if (!s) return;
  const cur = s.value;
  s.innerHTML = '<option value="">General / not route-specific</option>' + masterlist.map((r) => `<option>${esc(r.start)} → ${esc(r.destination)}</option>`).join('');
  s.value = cur;
}
function renderMine() {
  const rs = LS.get('pt_reports', []).slice().reverse();
  $('pt-mine').innerHTML = rs.map((r) => `<div class="pt-item"><span><b>${esc(r.type)}</b> · ${esc(r.route || 'General')}<br><small>${esc(r.text)}</small></span><em class="pt-st ${esc(r.status)}">${esc(r.status)}</em></div>`).join('') || '<p class="pt-hint">You have not sent any reports from this device.</p>';
}

/* ── Commuter UI ── */
function buildUI() {
  const sel = document.querySelector('.selector-card');
  sel.insertAdjacentHTML('beforeend', '<div class="pt-near"><button type="button" id="pt-near-btn" class="map-action-btn secondary">◎ Use my location as origin</button><div id="pt-near-out" aria-live="polite"></div></div>');
  $('distance-bar').insertAdjacentHTML('beforebegin', '<div id="pt-walk" class="pt-notice info" hidden></div>');
  $('distance-bar').insertAdjacentHTML('afterend', '<div id="pt-fare" class="card pt-box"></div>');
  document.querySelector('.map-container').insertAdjacentHTML('afterend', '<div id="pt-eta" class="pt-hint" aria-live="polite"></div>');
  $('all-routes-list').insertAdjacentHTML('beforebegin', '<div class="pt-sort"><label>Sort by <select id="pt-sort"><option value="az">Default (A–Z)</option><option value="near">Nearest to me</option><option value="dist">Shortest trip distance</option><option value="fare">Lowest fare</option></select></label><span id="pt-sort-msg" class="pt-hint"></span></div>');
  $('tab-guide').insertAdjacentHTML('afterend', `<section id="tab-report" class="tab-content">
    <div class="card pt-box"><h3>Report a correction</h3><p class="pt-hint">Found a wrong fare, route or terminal location? Tell us. An admin checks every report before anything changes.</p>
      <label>What is wrong?<select id="pt-rtype"><option>Wrong fare</option><option>Wrong or missing route</option><option>Wrong terminal location</option><option>Landmark photo or description</option><option>Delay or suspension</option><option>Other</option></select></label>
      <label>Route<select id="pt-rroute"></select></label>
      <div class="pt-grid"><label>Correct fare, if you know it (₱)<input id="pt-rfare" type="number" min="0" step="0.5" inputmode="decimal"></label><label>Contact (optional)<input id="pt-rcontact" maxlength="80" placeholder="Email or mobile number"></label></div>
      <label>Details<textarea id="pt-rtext" rows="4" maxlength="300" placeholder="What did you see? When and where?"></textarea></label>
      <input id="pt-hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
      <button type="button" id="pt-rsend" class="map-action-btn primary">Submit report</button><p class="pt-hint" id="pt-rmsg"></p></div>
    <div class="card pt-box"><h3>Your reports</h3><div id="pt-mine"></div></div></section>`);
  document.querySelector('.bottom-nav').insertAdjacentHTML('beforeend', '<button id="nav-btn-report" class="nav-item" onclick="switchTab(\'tab-report\', this)"><span class="nav-icon">!</span><span>Report</span></button>');
  $('nav-btn-report').addEventListener('click', () => { const d = $('dest-select').value; if (!$('pt-rroute').value && sv() && d) $('pt-rroute').value = `${sv()} → ${d}`; renderMine(); });
  $('pt-near-btn').onclick = nearMe;
  new MutationObserver(calc).observe($('dist-value'), { childList: true, characterData: true, subtree: true });
  $('pt-sort').onchange = async () => {
    const m = $('pt-sort').value, msg = $('pt-sort-msg');
    if (m === 'near' && !me.lat && !(await locate())) { msg.textContent = 'Allow location access to sort by nearest.'; $('pt-sort').value = 'az'; return; }
    if (m === 'near') await warm(masterlist.map((r) => (originCoord(r) ? '' : r.start)), msg);
    if (m === 'dist') await warm(masterlist.flatMap((r) => [originCoord(r) ? '' : r.start, r.destination]), msg);
    searchAllRoutes();
  };
  $('pt-rsend').onclick = () => {
    const m = $('pt-rmsg'), text = clean($('pt-rtext').value);
    if ($('pt-hp').value) return;
    if (text.length < 10) { m.textContent = 'Please describe the problem (at least 10 characters).'; return; }
    if (Date.now() - LS.get('pt_last', 0) < 30000) { m.textContent = 'Please wait a moment before sending another report.'; return; }
    const r = { id: Date.now().toString(36), ts: new Date().toISOString(), type: $('pt-rtype').value, route: clean($('pt-rroute').value), fare: clean($('pt-rfare').value), contact: clean($('pt-rcontact').value), text, status: 'pending' };
    LS.set('pt_reports', LS.get('pt_reports', []).concat(r)); LS.set('pt_last', Date.now());
    if (REPORT_ENDPOINT) fetch(REPORT_ENDPOINT, { method: 'POST', mode: 'no-cors', body: JSON.stringify(r) }).catch(() => {});
    ['pt-rtext', 'pt-rfare', 'pt-rcontact'].forEach((id) => ($(id).value = ''));
    m.textContent = REPORT_ENDPOINT ? 'Thank you! Your report was sent for admin review.' : 'Saved on this device. It reaches the admin once a shared backend is connected.';
    renderMine();
  };
  fillReportRoutes(); renderMine();
}

/* ── Administrator module (open with  index.html#admin ) ── */
const FIELDS = [['start', 'Origin station'], ['destination', 'Destination landmark'], ['terminal', 'Trip name'], ['type', 'Vehicle type'], ['signboard', 'Signboard / color'], ['regularFare', 'Regular fare (₱)'], ['studentFare', 'Student fare (₱)'], ['dropoff', 'Drop-off instructions'], ['landmarkName', 'Landmark name'], ['landmarkDesc', 'Landmark description'], ['landmarkImg', 'Landmark image URL'], ['gmapLink', 'Google Maps link'], ['lat', 'Origin latitude'], ['lon', 'Origin longitude'], ['stopovers', 'Stopovers']];
const ALIAS = { start: ['start', 'startingpoint', 'origin', 'from'], destination: ['destination', 'endpoint', 'to'], terminal: ['tripname', 'terminal', 'route'], type: ['vehicletype', 'type', 'vehicle'], signboard: ['signboardcolor', 'signboard'], regularFare: ['regularfare', 'regular', 'fare'], studentFare: ['studentfare', 'student'], dropoff: ['dropoffinstructions', 'dropoff', 'instructions'], gmapLink: ['originmaplink', 'googlemapslink', 'maplink'], landmarkName: ['landmarkname', 'landmark'], landmarkDesc: ['landmarkdescription', 'landmarkdesc'], landmarkImg: ['landmarkimage', 'landmarkimg', 'image', 'photo'], lat: ['lat', 'latitude'], lon: ['lon', 'lng', 'longitude'], stopovers: ['stopovers'] };
const TABS = { notices: 'Notices', fare: 'Fare', routes: 'Routes', reports: 'Reports', import: 'Import', publish: 'Publish' };
let tab = 'notices', edit = null, editKey = null;

async function sha(s) { if (!window.crypto || !crypto.subtle) return s; const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function login() {
  const h = LS.get('pt_pin', null), pin = prompt(h ? 'Admin PIN:' : 'First use: set an admin PIN (6+ characters):');
  if (!pin) return false;
  if (!h) { if (pin.length < 6) { alert('PIN too short.'); return false; } LS.set('pt_pin', await sha(pin)); return true; }
  return (await sha(pin)) === h;
}
const sections = {
  notices: () => `<div class="pt-list">${DB.notices.map((n, i) => `<div class="pt-item"><span><b>${esc(n.level)}</b> ${esc(n.text)}${n.until ? ` · until ${esc(n.until)}` : ''}</span><button data-a="delnotice" data-i="${i}">Delete</button></div>`).join('') || '<p class="pt-hint">No announcements.</p>'}</div>
    <h3>Post announcement</h3><label>Message<textarea id="a-ntext" rows="2" maxlength="200"></textarea></label>
    <div class="pt-grid"><label>Type<select id="a-nlevel"><option value="info">Advisory</option><option value="warn">Delay / holiday</option><option value="alert">Suspension</option></select></label><label>Show until<input id="a-nuntil" type="date"></label></div>
    <button data-a="addnotice" class="map-action-btn primary">Post</button>`,
  fare: () => { const f = DB.fare, g = (k, t, c) => `<fieldset><legend>${t}</legend><div class="pt-grid"><label>Base fare (₱)<input id="a-${k}-base" type="number" step="0.01" value="${c.base}"></label><label>Base km<input id="a-${k}-baseKm" type="number" step="0.1" value="${c.baseKm}"></label><label>Per extra km (₱)<input id="a-${k}-perKm" type="number" step="0.01" value="${c.perKm}"></label></div></fieldset>`;
    return g('trad', 'Traditional jeepney', f.trad) + g('modern', 'Modern jeepney', f.modern) + `<div class="pt-grid"><label>Discount (%)<input id="a-disc" type="number" value="${f.discount}"></label><label>Matrix label / effectivity<input id="a-upd" value="${esc(f.updated)}"></label></div><button data-a="savefare" class="map-action-btn primary">Save fare settings</button>`; },
  routes: () => `<div class="pt-list">${masterlist.map((r, i) => `<div class="pt-item"><span>${esc(r.start)} → ${esc(r.destination)} <small>${esc(r.type)} · ₱${r.regularFare}${r.admin ? ' · admin' : ''}</small></span><span><button data-a="editroute" data-i="${i}">Edit</button> <button data-a="delroute" data-i="${i}">Delete</button></span></div>`).join('')}</div>
    <p><button data-a="geo">Locate all places (one-time)</button> <span class="pt-hint" id="a-geo"></span></p><h3>${edit ? 'Edit' : 'Add'} route</h3><div class="pt-grid">${FIELDS.map(([k, l]) => `<label>${l}<input data-f="${k}" value="${esc(edit ? edit[k] ?? '' : '')}"></label>`).join('')}</div><button data-a="saveroute" class="map-action-btn primary">${edit ? 'Update' : 'Add'} route</button>`,
  reports: () => `<p class="pt-hint">Approved reports are not applied automatically: make the change under Routes or Fare.</p><div class="pt-list">${LS.get('pt_reports', []).map((r, i) => `<div class="pt-item"><span><b>${esc(r.type)}</b> · ${esc(r.route)} <em>(${esc(r.status)})</em><br>${esc(r.text)}${r.fare ? ` · suggests ₱${esc(r.fare)}` : ''}${r.contact ? ` · contact: ${esc(r.contact)}` : ''}</span><span><button data-a="rep" data-s="approved" data-i="${i}">Approve</button> <button data-a="rep" data-s="dismissed" data-i="${i}">Dismiss</button></span></div>`).join('') || '<p class="pt-hint">No reports on this device.</p>'}</div>`,
  import: () => '<p class="pt-hint">Upload a CSV (in Excel: File → Save As → CSV). Required columns: Start, Destination, Regular Fare. Routes with the same start and destination are replaced.</p><input id="a-file" type="file" accept=".csv,text/csv"><p class="pt-hint" id="a-imsg"></p><button data-a="template" class="map-action-btn secondary">Download CSV template</button>',
  publish: () => '<p class="pt-hint">Edits are saved in this browser only. To publish them to all commuters, download the file and replace <code>site-data.json</code> in the site folder.</p><button data-a="export" class="map-action-btn primary">Download site-data.json</button> <button data-a="reset" class="map-action-btn secondary">Discard local edits</button>',
};
function drawAdmin() {
  const n = LS.get('pt_reports', []).filter((r) => r.status === 'pending').length;
  $('pt-admin').innerHTML = `<div class="pt-admin-in"><div class="pt-ahead"><h2>Admin</h2><button data-a="close">Close ✕</button></div><div class="pt-tabs">${Object.entries(TABS).map(([k, v]) => `<button data-a="tab" data-v="${k}" class="${k === tab ? 'on' : ''}">${v}${k === 'reports' && n ? ` (${n})` : ''}</button>`).join('')}</div>${sections[tab]()}</div>`;
}
const commit = () => { save(); refresh(); drawAdmin(); };
const dl = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
const val = (id) => $(id).value;
function importCSV(file) {
  if (!file) return;
  Papa.parse(file, { header: true, skipEmptyLines: true, complete: ({ data }) => {
    let ok = 0;
    data.forEach((row) => {
      const n = {}, o = {};
      Object.keys(row).forEach((k) => (n[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = row[k]));
      Object.entries(ALIAS).forEach(([f, names]) => { const hit = names.find((a) => n[a] != null && n[a] !== ''); if (hit) o[f] = clean(n[hit]); });
      o.regularFare = parseCurrencyNumber(o.regularFare); o.studentFare = parseCurrencyNumber(o.studentFare);
      if (!o.start || !o.destination || !(o.regularFare > 0)) return;
      DB.routes = DB.routes.filter((r) => keyOf(r) !== keyOf(o)); DB.routes.push(o); ok++;
    });
    $('a-imsg').textContent = `Imported ${ok} route(s); skipped ${data.length - ok}.`; save(); refresh();
  } });
}
async function adminClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const i = +b.dataset.i;
  switch (b.dataset.a) {
    case 'close': $('pt-admin').remove(); document.body.style.overflow = ''; history.replaceState(null, '', location.pathname + location.search); return;
    case 'tab': tab = b.dataset.v; edit = editKey = null; return drawAdmin();
    case 'addnotice': { const t = clean(val('a-ntext')); if (!t) return; DB.notices.push({ id: 'n' + Date.now().toString(36), text: t, level: val('a-nlevel'), until: val('a-nuntil') }); renderNotices(); return commit(); }
    case 'delnotice': DB.notices.splice(i, 1); renderNotices(); return commit();
    case 'savefare': ['trad', 'modern'].forEach((k) => ['base', 'baseKm', 'perKm'].forEach((p) => { DB.fare[k][p] = parseFloat(val(`a-${k}-${p}`)) || 0; })); DB.fare.discount = parseFloat(val('a-disc')) || 0; DB.fare.updated = clean(val('a-upd')); save(); calc(); return alert('Fare settings saved.');
    case 'editroute': edit = masterlist[i]; editKey = keyOf(edit); return drawAdmin();
    case 'delroute': { const r = masterlist[i]; if (!confirm(`Delete ${r.start} → ${r.destination}?`)) return; if (r.admin) DB.routes = DB.routes.filter((x) => keyOf(x) !== keyOf(r)); else DB.hidden.push(keyOf(r)); return commit(); }
    case 'saveroute': {
      const o = {}; $('pt-admin').querySelectorAll('[data-f]').forEach((f) => (o[f.dataset.f] = clean(f.value)));
      o.regularFare = parseCurrencyNumber(o.regularFare); o.studentFare = parseCurrencyNumber(o.studentFare);
      if (!o.start || !o.destination || !(o.regularFare > 0)) return alert('Origin, destination and a regular fare are required.');
      if (editKey) { DB.routes = DB.routes.filter((r) => keyOf(r) !== editKey); if (!edit.admin) DB.hidden.push(editKey); }
      DB.routes = DB.routes.filter((r) => keyOf(r) !== keyOf(o)); DB.routes.push(o); edit = editKey = null; return commit();
    }
    case 'geo': { const all = masterlist.flatMap((r) => [r.start, r.destination]); await warm(all, $('a-geo')); DB.coords = { ...DB.coords, ...Object.fromEntries(all.map((n) => [n.toLowerCase(), cd(n)]).filter(([, v]) => v)) }; save(); $('a-geo').textContent = 'Done. Now export site-data.json from the Publish tab.'; return; }
    case 'rep': { const rs = LS.get('pt_reports', []); rs[i].status = b.dataset.s; LS.set('pt_reports', rs); return drawAdmin(); }
    case 'template': return dl('routes-template.csv', 'Start,Destination,Trip Name,Vehicle Type,Signboard / Color,Regular Fare,Student Fare,Drop-off Instructions,Landmark Name,Landmark Description,Landmark Image,Map Link,Lat,Lon,Stopovers\n', 'text/csv');
    case 'export': return dl('site-data.json', JSON.stringify(DB, null, 2), 'application/json');
    case 'reset': if (confirm('Discard all local admin edits?')) { localStorage.removeItem('pt_data'); location.reload(); }
  }
}
async function openAdmin() {
  if ($('pt-admin')) return;
  if (!(await login())) { history.replaceState(null, '', location.pathname + location.search); return; }
  const el = document.createElement('div'); el.id = 'pt-admin'; document.body.appendChild(el);
  el.addEventListener('click', adminClick);
  el.addEventListener('change', (e) => { if (e.target.id === 'a-file') importCSV(e.target.files[0]); });
  document.body.style.overflow = 'hidden'; drawAdmin();
}

/* ── Boot (runs after app.js's own DOMContentLoaded handler) ── */
document.addEventListener('DOMContentLoaded', async () => {
  await loadDB();
  Object.assign(coords, DB.coords || {});
  buildUI(); renderNotices();
  const cached = LS.get('pt_cache', null);
  if (cached && !$('sync-dot').classList.contains('live')) { masterlist = cached; $('sync-label').textContent = 'Saved'; }
  refresh();
  if (location.hash === '#admin') openAdmin();
});
window.addEventListener('hashchange', () => { if (location.hash === '#admin') openAdmin(); });
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
