// NYC Apartment Check — static, client-side only.
// All data comes from NYC Open Data (Socrata SODA API) and NYC Planning GeoSearch,
// both of which allow cross-origin browser requests.

// Optional: a free Socrata app token raises rate limits. It is not a secret.
// Get one at https://data.cityofnewyork.us/profile/edit/developer_settings
const APP_TOKEN = '';

const OD = 'https://data.cityofnewyork.us/resource/';
const GEO = 'https://geosearch.planninglabs.nyc/v2/';

const DS = {
  hpdViol: 'wvxf-dwi5',      // HPD Housing Maintenance Code Violations
  hpdComp: 'ygpa-z7cr',      // HPD Complaints and Problems
  hpdReg: 'tesw-yqqr',       // HPD Multiple Dwelling Registrations
  hpdContacts: 'feu5-w2e2',  // HPD Registration Contacts
  hpdLit: '59kj-x8nc',       // HPD Housing Litigations
  evictions: '6z8x-wfk4',    // Marshal evictions
  dobViol: '3h2n-5cm9',      // DOB Violations
  ecb: '6bgk-3dad',          // DOB ECB Violations
  dobComp: 'eabe-havv',      // DOB Complaints Received
  dobPermits: 'ipu4-2q9a',   // DOB Permit Issuance (BIS legacy)
  dobNowJobs: 'w9ak-ipjd',   // DOB NOW: Build – Job Application Filings
  dobNowPermits: 'rbx6-tga4',// DOB NOW: Build – Approved Permits
  sr311: 'erm2-nwe9',        // 311 Service Requests 2020–present
  crimeYtd: '5uac-w243',     // NYPD Complaint Data Current (YTD)
  crimeHist: 'qgea-i56i',    // NYPD Complaint Data Historic
  pluto: '64uk-42ks',        // PLUTO
};

const BORO_NAME = { 1: 'MANHATTAN', 2: 'BRONX', 3: 'BROOKLYN', 4: 'QUEENS', 5: 'STATEN ISLAND' };
const NYC_LAND_M2 = 783.8e6; // ~302.6 sq mi

// ---------- utilities ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => (v == null || v === '' ? 0 : Number(v));
const fmtN = (v) => n(v).toLocaleString('en-US');
const money = (v) => '$' + Math.round(n(v)).toLocaleString('en-US');
const daysAgoISO = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10) + 'T00:00:00';
const sq = (s) => String(s).replace(/'/g, "''");

// Normalise the many date formats in these datasets to YYYY-MM-DD.
function normDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return s;
}
const fmtDate = (v) => {
  const d = normDate(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return esc(d);
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
};
const byDateDesc = (key) => (a, b) => normDate(b[key]).localeCompare(normDate(a[key]));

// Placeholder BINs (e.g. 3000000) mean "no real building id" and would match unrelated records.
const validBin = (b) => /^[1-5]\d{6}$/.test(String(b || '')) && !/^[1-5]000000$/.test(String(b));

function normApt(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(APT|APARTMENT|UNIT|NO)/, '').replace(/^0+(?=\w)/, '');
}

async function soql(id, params = {}, timeoutMs = 90000) {
  const url = new URL(OD + id + '.json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set('$' + k, v);
  if (APP_TOKEN) url.searchParams.set('$$app_token', APP_TOKEN);
  // NYC Open Data occasionally returns 429/5xx under load; retry a couple of times.
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (r.ok) return await r.json();
      if ((r.status === 429 || r.status >= 500) && attempt < 3) {
        await new Promise((res) => setTimeout(res, 800 * 2 ** attempt + Math.random() * 400));
        continue;
      }
      throw new Error(`${r.status} from NYC Open Data`);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('NYC Open Data took too long to respond — try again');
      if (e instanceof TypeError && attempt < 2) { await new Promise((res) => setTimeout(res, 1000)); continue; }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
}

// ---------- small render helpers ----------
function pill(text, level = '') { return `<span class="pill ${level}">${esc(text)}</span>`; }
function loading(msg = 'Loading…') { return `<p class="note"><span class="spin"></span> ${esc(msg)}</p>`; }
function errBox(e) { return `<p class="err">Couldn’t load: ${esc(e.message || e)}</p>`; }

function bars(items, { max = 10 } = {}) {
  const list = items.slice(0, max);
  if (!list.length) return '<p class="note">None.</p>';
  const top = Math.max(...list.map((i) => i.n), 1);
  return `<div class="bars">${list.map((i) => `
    <div class="bar"><span class="lbl" title="${esc(i.label)}">${esc(i.label)}</span>
    <span class="track"><span class="fill" style="width:${(100 * i.n / top).toFixed(1)}%"></span></span>
    <span class="num">${fmtN(i.n)}</span></div>`).join('')}</div>`;
}

// cols: [{ h: 'Header', f: row => html, cls }]
function table(el, rows, cols, { page = 15, rowClass = () => '', empty = 'No records.', filter = true } = {}) {
  let shown = page;
  let q = '';
  const draw = () => {
    const ql = q.toLowerCase();
    const filtered = ql ? rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(ql))) : rows;
    if (!rows.length) { el.innerHTML = `<p class="note">${esc(empty)}</p>`; return; }
    const vis = filtered.slice(0, shown);
    el.innerHTML = `
      ${filter && rows.length > page ? `<input class="tfilter" type="search" placeholder="Filter these ${fmtN(rows.length)} rows…" value="${esc(q)}" style="margin-bottom:6px">` : ''}
      <div class="tbl-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c.h)}</th>`).join('')}</tr></thead>
      <tbody>${vis.map((r) => `<tr class="${rowClass(r)}">${cols.map((c) => `<td class="${c.cls || ''}">${c.f(r) ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="tbl-foot"><span>Showing ${fmtN(vis.length)} of ${fmtN(filtered.length)}</span>
      ${filtered.length > shown ? `<button class="link more">Show ${fmtN(Math.min(filtered.length - shown, 100))} more</button>` : ''}</div>`;
    const inp = $('.tfilter', el);
    if (inp) {
      inp.addEventListener('input', () => { q = inp.value; shown = page; draw(); const i2 = $('.tfilter', el); i2.focus(); i2.setSelectionRange(q.length, q.length); });
    }
    const more = $('.more', el);
    if (more) more.addEventListener('click', () => { shown += 100; draw(); });
  };
  draw();
}

// ---------- address search ----------
const addrEl = $('#addr');
const aptEl = $('#apt');
const sugEl = $('#suggest');
let suggestions = [];
let activeIdx = -1;
let chosen = null;
let sugTimer;

function featureToPlace(f) {
  const p = f.properties || {};
  const pad = p.addendum && p.addendum.pad;
  if (!pad || !pad.bbl) return null;
  const [lon, lat] = f.geometry.coordinates;
  return {
    label: `${titleCase(p.name)}, ${p.borough}${p.postalcode ? ' ' + p.postalcode : ''}`,
    bbl: pad.bbl, bin: pad.bin, lat, lon, borough: p.borough, neighbourhood: p.neighbourhood || '',
  };
}
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()); }

async function geo(path, text) {
  const r = await fetch(`${GEO}${path}?text=${encodeURIComponent(text)}`);
  if (!r.ok) throw new Error('Address lookup failed');
  const j = await r.json();
  return (j.features || []).map(featureToPlace).filter(Boolean);
}

function renderSuggest() {
  if (!suggestions.length) { sugEl.hidden = true; return; }
  sugEl.innerHTML = suggestions.map((s, i) => `<li role="option" data-i="${i}" aria-selected="${i === activeIdx}">${esc(s.label)}${s.neighbourhood ? `<small>${esc(s.neighbourhood)}</small>` : ''}</li>`).join('');
  sugEl.hidden = false;
}
addrEl.addEventListener('input', () => {
  chosen = null;
  clearTimeout(sugTimer);
  const t = addrEl.value.trim();
  if (t.length < 3) { suggestions = []; renderSuggest(); return; }
  sugTimer = setTimeout(async () => {
    try { suggestions = (await geo('autocomplete', t)).slice(0, 8); activeIdx = -1; renderSuggest(); } catch { /* ignore */ }
  }, 220);
});
addrEl.addEventListener('keydown', (e) => {
  if (sugEl.hidden) return;
  if (e.key === 'ArrowDown') { activeIdx = Math.min(activeIdx + 1, suggestions.length - 1); renderSuggest(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { activeIdx = Math.max(activeIdx - 1, 0); renderSuggest(); e.preventDefault(); }
  else if (e.key === 'Enter' && activeIdx >= 0) { pick(activeIdx); e.preventDefault(); }
  else if (e.key === 'Escape') { sugEl.hidden = true; }
});
sugEl.addEventListener('mousedown', (e) => {
  const li = e.target.closest('li'); if (!li) return;
  e.preventDefault(); pick(Number(li.dataset.i));
});
addrEl.addEventListener('blur', () => setTimeout(() => (sugEl.hidden = true), 150));
function pick(i) {
  chosen = suggestions[i];
  addrEl.value = chosen.label;
  sugEl.hidden = true;
  $('#search').requestSubmit();
}

$('#search').addEventListener('submit', async (e) => {
  e.preventDefault();
  sugEl.hidden = true;
  let place = chosen;
  if (!place) {
    const res = $('#results');
    res.hidden = false; $('#intro').hidden = true;
    res.innerHTML = `<div class="card">${loading('Finding address…')}</div>`;
    try {
      const found = await geo('search', addrEl.value.trim());
      place = found[0];
    } catch (err) { res.innerHTML = `<div class="card">${errBox(err)}</div>`; return; }
    if (!place) { res.innerHTML = `<div class="card"><p class="err">No NYC address found for “${esc(addrEl.value)}”. Try including the borough, e.g. “123 Main St, Queens”.</p></div>`; return; }
    addrEl.value = place.label;
  }
  run({ ...place, apt: aptEl.value.trim() });
});

// ---------- main report ----------
let current = null;

function run(place) {
  current = place;
  const qs = new URLSearchParams({ q: place.label, bbl: place.bbl, bin: place.bin, lat: place.lat, lon: place.lon });
  if (place.apt) qs.set('apt', place.apt);
  history.replaceState(null, '', '?' + qs.toString());
  document.title = `${place.label} — NYC Apartment Check`;

  $('#intro').hidden = true;
  const res = $('#results');
  res.hidden = false;
  const boro = place.bbl[0], block = place.bbl.slice(1, 6), lot = place.bbl.slice(6);
  place.boro = boro; place.block = block; place.lot = lot;

  res.innerHTML = `
    <section class="card" id="bldg">
      <div class="bldg-head">
        <div>
          <h2>${esc(place.label)}</h2>
          <p class="sub">${esc(place.neighbourhood ? place.neighbourhood + ' · ' : '')}BBL ${esc(boro)}-${esc(block)}-${esc(lot)} · BIN ${esc(place.bin)}${place.apt ? ' · Apt ' + esc(place.apt) : ''}</p>
        </div>
      </div>
      <div class="links">
        <a id="lnk-hpd" href="https://hpdonline.nyc.gov/hpdonline/" target="_blank" rel="noopener">HPD Online ↗</a>
        <a href="https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${esc(place.bin)}" target="_blank" rel="noopener">DOB BIS ↗</a>
        <a href="https://a810-dobnow.nyc.gov/publish/Index.html#!/" target="_blank" rel="noopener">DOB NOW ↗</a>
        <a href="https://portal.311.nyc.gov/" target="_blank" rel="noopener">311 ↗</a>
        <a href="https://maps.nyc.gov/crime/" target="_blank" rel="noopener">NYPD Crime Map ↗</a>
        <a href="https://whoownswhat.justfix.org/en/bbl/${esc(place.bbl)}" target="_blank" rel="noopener">Who Owns What ↗</a>
        <a href="https://zola.planning.nyc.gov/l/lot/${esc(boro)}/${Number(block)}/${Number(lot)}" target="_blank" rel="noopener">ZoLa ↗</a>
        <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${place.lat},${place.lon}" target="_blank" rel="noopener">Street View ↗</a>
      </div>
      <div id="facts">${loading('Loading building details…')}</div>
    </section>

    <section class="card">
      <h2>At a glance</h2>
      <p class="sub">Red = worth asking about before you sign. Counts are for the whole building${place.apt ? '; your unit is highlighted in the tables below' : ''}.</p>
      <div class="glance" id="glance"></div>
    </section>

    <section class="card" id="hpd">
      <h2>HPD — Housing Preservation &amp; Development <span class="src muted">violations · complaints · court · evictions</span></h2>
      <div id="hpd-body">${loading()}</div>
    </section>

    <section class="card" id="dob">
      <h2>DOB — Department of Buildings <span class="src muted">BIS + DOB NOW</span></h2>
      <div id="dob-body">${loading()}</div>
    </section>

    <section class="card" id="s311">
      <h2>311 service requests</h2>
      <div id="s311-body">${loading()}</div>
    </section>

    <section class="card" id="crime">
      <h2>NYPD reported crime nearby</h2>
      <div class="tabs" id="radius-tabs">
        ${[[150, '1 block (~150 m)'], [400, '¼ mile (400 m)'], [800, '½ mile (800 m)']].map(([r, l]) => `<button type="button" data-r="${r}" aria-pressed="${r === 400}">${l}</button>`).join('')}
      </div>
      <div id="map"></div>
      <div class="legend"><span><span class="dot" style="background:#d32f2f"></span>Felony</span><span><span class="dot" style="background:#f39c12"></span>Misdemeanor</span><span><span class="dot" style="background:#8e99a8"></span>Violation</span><span><span class="dot" style="background:#1f5fbf"></span>This building</span></div>
      <div id="crime-body">${loading()}</div>
    </section>

    <section class="card" id="rs">
      <h2>Rent stabilization</h2>
      <div id="rs-body">${loading()}</div>
    </section>
  `;

  glanceInit(place);
  const buildingP = loadBuilding(place);
  loadHPD(place);
  loadDOB(place);
  load311(place);
  initCrime(place);
  buildingP.then((info) => renderRentStab(place, info)).catch((e) => ($('#rs-body').innerHTML = errBox(e)));
}

// ---------- at-a-glance ----------
const GLANCE = [
  ['hpdC', 'Open HPD Class C violations (immediately hazardous)'],
  ['hpdOpen', 'Open HPD violations, all classes'],
  ['hpdComp', 'HPD complaints, last 12 months'],
  ['heat', 'Heat / hot water complaints, last 12 months'],
  ['harass', 'Housing court cases (harassment findings)'],
  ['evict', 'Marshal evictions, last 3 years'],
  ['dobOpen', 'Active DOB violations'],
  ['ecbDue', 'ECB fines still owed'],
  ['crime', 'Crime vs. NYC average (¼ mile, this year)'],
];
function glanceInit() {
  $('#glance').innerHTML = GLANCE.map(([k, l]) => `<div class="stat loading" id="g-${k}"><div class="n"><span class="spin"></span></div><div class="l">${esc(l)}</div></div>`).join('');
}
function setGlance(key, value, level = '', label) {
  const el = $('#g-' + key); if (!el) return;
  el.className = 'stat ' + level;
  $('.n', el).innerHTML = esc(value);
  if (label) $('.l', el).textContent = label;
}
function glanceErr(...keys) { keys.forEach((k) => setGlance(k, '—', '', undefined)); }

// ---------- building facts ----------
async function loadBuilding(p) {
  const [pluto, reg] = await Promise.all([
    soql(DS.pluto, { select: 'address,yearbuilt,yearalter1,yearalter2,unitsres,unitstotal,numfloors,numbldgs,bldgclass,landuse,ownername,zonedist1,histdist,landmark,lotarea,bldgarea', where: `bbl=${p.bbl}`, limit: 1 }).catch(() => []),
    soql(DS.hpdReg, { where: `boroid=${p.boro} AND block=${Number(p.block)} AND lot=${Number(p.lot)}`, order: 'lastregistrationdate DESC', limit: 5 }).catch(() => []),
  ]);
  const pl = pluto[0] || {};
  const r = reg.find((x) => x.bin === String(p.bin)) || reg[0];
  let contacts = [];
  if (r) {
    contacts = await soql(DS.hpdContacts, { where: `registrationid=${Number(r.registrationid)}`, limit: 50 }).catch(() => []);
    $('#lnk-hpd').href = `https://hpdonline.nyc.gov/hpdonline/building/${encodeURIComponent(r.buildingid)}`;
  }
  const who = (types) => {
    const c = contacts.filter((x) => types.includes(x.type));
    return [...new Set(c.map((x) => x.corporationname || [x.firstname, x.lastname].filter(Boolean).join(' ')).filter(Boolean))].map(titleCase).join('; ');
  };
  const facts = [
    ['Year built', pl.yearbuilt && pl.yearbuilt !== '0' ? pl.yearbuilt : '—'],
    ['Residential units', pl.unitsres ? fmtN(pl.unitsres) : '—'],
    ['Floors', pl.numfloors ? Math.round(n(pl.numfloors)) : '—'],
    ['Building class', pl.bldgclass ? `${pl.bldgclass} · ${bldgClassName(pl.bldgclass)}` : '—'],
    ['Owner (tax records)', pl.ownername ? titleCase(pl.ownername) : '—'],
    ['Owner (HPD registration)', who(['CorporateOwner', 'IndividualOwner', 'JointOwner']) || '—'],
    ['Managing agent', who(['Agent']) || '—'],
    ['Head officer', who(['HeadOfficer']) || '—'],
    ['HPD registration', r ? `${r.registrationenddate && normDate(r.registrationenddate) < new Date().toISOString().slice(0, 10) ? 'EXPIRED ' : 'Valid until '}${fmtDate(r.registrationenddate)}` : (n(pl.unitsres) >= 3 ? 'Not found (required for 3+ units)' : 'Not required / not found')],
    ['Zoning', pl.zonedist1 || '—'],
    ['Historic district', pl.histdist || (pl.landmark ? 'Landmark: ' + pl.landmark : 'No')],
  ];
  $('#facts').innerHTML = `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>`;
  return { pluto: pl, reg: r };
}

function bldgClassName(c) {
  const m = {
    A: 'One family', B: 'Two family', C: 'Walk-up apartments', D: 'Elevator apartments', R: 'Condo', S: 'Mixed residential/store',
    K: 'Store building', O: 'Office', H: 'Hotel', L: 'Loft', M: 'Religious', W: 'Educational', I: 'Health', V: 'Vacant land', G: 'Garage', E: 'Warehouse', F: 'Factory',
  };
  const special = { C6: 'Walk-up co-op', D4: 'Elevator co-op', C8: 'Walk-up co-op', D0: 'Elevator co-op', R4: 'Condo residential unit', RR: 'Condo rentals', R9: 'Co-op within condo' };
  return special[c] || m[c[0]] || 'Other';
}

// ---------- HPD ----------
async function loadHPD(p) {
  const body = $('#hpd-body');
  const yr = daysAgoISO(365), yr3 = daysAgoISO(365 * 3);
  const hasBin = validBin(p.bin);
  const vWhere = hasBin ? `(bbl='${p.bbl}' OR bin='${p.bin}')` : `bbl='${p.bbl}'`;
  const cWhere = hasBin ? `(bbl=${p.bbl} OR bin=${p.bin})` : `bbl=${p.bbl}`;
  const myApt = normApt(p.apt);
  const isMine = (a) => myApt && normApt(a) === myApt;

  body.innerHTML = `
    <div class="two">
      <div><h3>Violations by class</h3><div id="hpd-vclass">${loading()}</div></div>
      <div><h3>Complaints by category (last 3 years)</h3><div id="hpd-ccat">${loading()}</div></div>
    </div>
    <h3>Open violations</h3><div id="hpd-vopen">${loading()}</div>
    <h3>Recent complaints</h3><div id="hpd-crec">${loading()}</div>
    <h3>Housing court cases</h3><div id="hpd-lit">${loading()}</div>
    <h3>Marshal evictions</h3><div id="hpd-ev">${loading()}</div>
    <p class="note">Class A = non-hazardous, B = hazardous, C = immediately hazardous (e.g. no heat, lead paint, broken locks, vermin). Violations stay “open” until the landlord certifies the fix and HPD accepts it.</p>`;

  // violation counts
  soql(DS.hpdViol, { select: 'class, violationstatus, count(*) as n', where: vWhere, group: 'class, violationstatus' })
    .then((rows) => {
      const by = {};
      rows.forEach((r) => { by[r.class] ??= { Open: 0, Close: 0 }; by[r.class][r.violationstatus] = n(r.n); });
      const open = (c) => (by[c] ? by[c].Open : 0);
      const totalOpen = ['A', 'B', 'C', 'I'].reduce((s, c) => s + open(c), 0);
      const totalAll = rows.reduce((s, r) => s + n(r.n), 0);
      $('#hpd-vclass').innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Class</th><th>Open</th><th>Closed</th></tr></thead><tbody>
        ${['C', 'B', 'A', 'I'].filter((c) => by[c]).map((c) => `<tr><td>${pill(c, c === 'C' ? 'bad' : c === 'B' ? 'warn' : '')} ${esc({ A: 'Non-hazardous', B: 'Hazardous', C: 'Immediately hazardous', I: 'Info / orders' }[c])}</td><td>${fmtN(by[c].Open)}</td><td>${fmtN(by[c].Close)}</td></tr>`).join('') || '<tr><td colspan="3">No violations on record.</td></tr>'}
        </tbody></table></div><p class="note">${fmtN(totalAll)} violations on record since the 1990s.</p>`;
      setGlance('hpdC', fmtN(open('C')), open('C') > 5 ? 'bad' : open('C') > 0 ? 'warn' : 'ok');
      setGlance('hpdOpen', fmtN(totalOpen), totalOpen > 50 ? 'bad' : totalOpen > 10 ? 'warn' : 'ok');
    })
    .catch((e) => { $('#hpd-vclass').innerHTML = errBox(e); glanceErr('hpdC', 'hpdOpen'); });

  // open violation list
  soql(DS.hpdViol, { select: 'violationid,apartment,story,class,inspectiondate,novdescription,currentstatus,originalcorrectbydate', where: `${vWhere} AND violationstatus='Open'`, order: 'inspectiondate DESC', limit: 2000 })
    .then((rows) => {
      if (myApt) rows.sort((a, b) => (isMine(b.apartment) - isMine(a.apartment)));
      table($('#hpd-vopen'), rows, [
        { h: 'Date', f: (r) => fmtDate(r.inspectiondate) },
        { h: 'Class', f: (r) => pill(r.class, r.class === 'C' ? 'bad' : r.class === 'B' ? 'warn' : '') },
        { h: 'Apt', f: (r) => esc(r.apartment || r.story || '') },
        { h: 'Description', f: (r) => esc(r.novdescription), cls: 'desc' },
        { h: 'Status', f: (r) => esc(titleCase(r.currentstatus)) },
      ], { rowClass: (r) => (isMine(r.apartment) ? 'mine' : ''), empty: 'No open violations.' });
    })
    .catch((e) => ($('#hpd-vopen').innerHTML = errBox(e)));

  // complaints
  Promise.all([
    soql(DS.hpdComp, { select: 'count(distinct complaint_id) as n', where: `${cWhere} AND received_date>'${yr}'` }),
    soql(DS.hpdComp, { select: 'major_category, count(*) as n', where: `${cWhere} AND received_date>'${yr3}'`, group: 'major_category', order: 'n DESC', limit: 15 }),
    soql(DS.hpdComp, { select: 'received_date,complaint_id,apartment,space_type,major_category,minor_category,problem_code,type,complaint_status,problem_status', where: `${cWhere} AND received_date>'${yr3}'`, order: 'received_date DESC', limit: 1500 }),
  ]).then(([cnt, cats, recent]) => {
    const c12 = n(cnt[0] && cnt[0].n);
    setGlance('hpdComp', fmtN(c12), c12 > 100 ? 'bad' : c12 > 20 ? 'warn' : 'ok');
    $('#hpd-ccat').innerHTML = bars(cats.map((r) => ({ label: titleCase(r.major_category || 'Other'), n: n(r.n) })));
    if (myApt) recent.sort((a, b) => (isMine(b.apartment) - isMine(a.apartment)) || normDate(b.received_date).localeCompare(normDate(a.received_date)));
    table($('#hpd-crec'), recent, [
      { h: 'Date', f: (r) => fmtDate(r.received_date) },
      { h: 'Apt', f: (r) => esc(r.apartment || '') },
      { h: 'Problem', f: (r) => `${esc(titleCase(r.major_category))}${r.minor_category ? ' — ' + esc(titleCase(r.minor_category)) : ''}${r.problem_code ? ` <span class="muted">(${esc(titleCase(r.problem_code))})</span>` : ''}`, cls: 'desc' },
      { h: 'Where', f: (r) => esc(titleCase(r.space_type)) },
      { h: 'Type', f: (r) => (r.type === 'EMERGENCY' || r.type === 'IMMEDIATE EMERGENCY' ? pill(titleCase(r.type), 'bad') : esc(titleCase(r.type))) },
      { h: 'Status', f: (r) => esc(titleCase(r.problem_status || r.complaint_status)) },
    ], { rowClass: (r) => (isMine(r.apartment) ? 'mine' : ''), empty: 'No HPD complaints in the last 3 years.' });
  }).catch((e) => { $('#hpd-ccat').innerHTML = errBox(e); $('#hpd-crec').innerHTML = ''; glanceErr('hpdComp'); });

  // litigation
  soql(DS.hpdLit, { select: 'caseopendate,casetype,casestatus,casejudgement,findingofharassment,findingdate,penalty,respondent', where: vWhere, order: 'caseopendate DESC', limit: 500 })
    .then((rows) => {
      rows.sort((x, y) => (!x.caseopendate - !y.caseopendate) || normDate(y.caseopendate).localeCompare(normDate(x.caseopendate)));
      const harass = rows.filter((r) => isHarassFinding(r.findingofharassment)).length;
      const harassCases = rows.filter((r) => /harass/i.test(r.casetype || '')).length;
      setGlance('harass', `${fmtN(rows.length)} (${fmtN(harass)})`, harass ? 'bad' : harassCases ? 'warn' : rows.length > 20 ? 'warn' : 'ok');
      table($('#hpd-lit'), rows, [
        { h: 'Opened', f: (r) => fmtDate(r.caseopendate) },
        { h: 'Case type', f: (r) => (/harass/i.test(r.casetype || '') ? pill(r.casetype, 'bad') : esc(r.casetype)) },
        { h: 'Status', f: (r) => esc(titleCase(r.casestatus)) },
        { h: 'Judgement', f: (r) => esc(r.casejudgement || '') },
        { h: 'Harassment finding', f: (r) => (r.findingofharassment ? pill(r.findingofharassment, isHarassFinding(r.findingofharassment) ? 'bad' : '') : '') },
        { h: 'Penalty', f: (r) => (r.penalty ? money(r.penalty) : '') },
      ], { page: 8, empty: 'No housing court cases brought by or against HPD for this building.' });
    })
    .catch((e) => { $('#hpd-lit').innerHTML = errBox(e); glanceErr('harass'); });

  // evictions
  soql(DS.evictions, { select: 'executed_date,eviction_apt_num,residential_commercial_ind,eviction_possession', where: vWhere, order: 'executed_date DESC', limit: 500 })
    .then((rows) => {
      const recent = rows.filter((r) => normDate(r.executed_date) >= yr3.slice(0, 10) && /resid/i.test(r.residential_commercial_ind || 'Residential')).length;
      setGlance('evict', fmtN(recent), recent > 10 ? 'bad' : recent > 2 ? 'warn' : 'ok');
      table($('#hpd-ev'), rows, [
        { h: 'Date', f: (r) => fmtDate(r.executed_date) },
        { h: 'Apt', f: (r) => esc(r.eviction_apt_num || '') },
        { h: 'Type', f: (r) => esc(titleCase(r.residential_commercial_ind)) },
        { h: 'Action', f: (r) => esc(titleCase(r.eviction_possession)) },
      ], { page: 6, rowClass: (r) => (isMine(r.eviction_apt_num) ? 'mine' : ''), empty: 'No marshal evictions on record (data since 2017).' });
    })
    .catch((e) => { $('#hpd-ev').innerHTML = errBox(e); glanceErr('evict'); });
}

// "After Trial" / "After Inquest" mean a court found harassment; "No Harassment" means it didn't.
function isHarassFinding(f) { return !!f && !/^no/i.test(f.trim()) && /after|yes|inquest|trial|found/i.test(f); }

// ---------- DOB ----------
async function loadDOB(p) {
  const body = $('#dob-body');
  body.innerHTML = `
    <h3>DOB violations</h3><div id="dob-v">${loading()}</div>
    <h3>ECB / OATH violations (fines)</h3><div id="dob-ecb">${loading()}</div>
    <h3>DOB complaints</h3><div id="dob-c">${loading()}</div>
    <h3>Permits &amp; job filings</h3><div id="dob-p">${loading()}</div>`;
  const bin = sq(p.bin);
  if (!validBin(p.bin)) {
    ['dob-v', 'dob-ecb', 'dob-c'].forEach((id) => ($('#' + id).innerHTML = '<p class="note">This lot has no building ID (BIN) in city records, so building-level DOB records can’t be matched. Permits by lot are shown below.</p>'));
    glanceErr('dobOpen', 'ecbDue');
  }
  const binQ = (fn) => (validBin(p.bin) ? fn() : Promise.resolve(null));

  binQ(() => soql(DS.dobViol, { select: 'issue_date,violation_type,violation_category,description,disposition_comments,number', where: `bin='${bin}'`, limit: 2000 }))
    .then((rows) => {
      if (!rows) return;
      rows.sort(byDateDesc('issue_date'));
      const active = rows.filter((r) => /ACTIVE/i.test(r.violation_category || ''));
      setGlance('dobOpen', fmtN(active.length), active.length > 10 ? 'bad' : active.length ? 'warn' : 'ok');
      rows.sort((a, b) => (/ACTIVE/i.test(b.violation_category) - /ACTIVE/i.test(a.violation_category)));
      table($('#dob-v'), rows, [
        { h: 'Issued', f: (r) => fmtDate(r.issue_date) },
        { h: 'Status', f: (r) => (/ACTIVE/i.test(r.violation_category) ? pill('Active', 'warn') : pill(/DISMISS/i.test(r.violation_category) ? 'Dismissed' : 'Resolved', 'ok')) },
        { h: 'Type', f: (r) => esc(titleCase((r.violation_type || '').replace(/^\S+-/, '').replace(/\s{2,}.*/, ''))) },
        { h: 'Description', f: (r) => esc(r.description || r.disposition_comments || ''), cls: 'desc' },
      ], { page: 10, empty: 'No DOB violations.' });
    })
    .catch((e) => { $('#dob-v').innerHTML = errBox(e); glanceErr('dobOpen'); });

  binQ(() => soql(DS.ecb, { select: 'issue_date,ecb_violation_status,severity,violation_type,violation_description,penality_imposed,balance_due,hearing_status,certification_status', where: `bin='${bin}'`, limit: 2000 }))
    .then((rows) => {
      if (!rows) return;
      rows.sort(byDateDesc('issue_date'));
      const due = rows.reduce((s, r) => s + Math.max(0, n(r.balance_due)), 0);
      setGlance('ecbDue', money(due), due > 10000 ? 'bad' : due > 0 ? 'warn' : 'ok');
      const activeN = rows.filter((r) => r.ecb_violation_status === 'ACTIVE').length;
      $('#dob-ecb').innerHTML = `<p class="note">${fmtN(activeN)} active of ${fmtN(rows.length)} · ${money(due)} balance due</p><div></div>`;
      rows.sort((a, b) => ((b.ecb_violation_status === 'ACTIVE') - (a.ecb_violation_status === 'ACTIVE')));
      table($('#dob-ecb > div'), rows, [
        { h: 'Issued', f: (r) => fmtDate(r.issue_date) },
        { h: 'Status', f: (r) => (r.ecb_violation_status === 'ACTIVE' ? pill('Active', 'warn') : pill('Resolved', 'ok')) },
        { h: 'Severity', f: (r) => (/hazard/i.test(r.severity || '') ? pill(r.severity, 'bad') : esc(r.severity || '')) },
        { h: 'Description', f: (r) => esc(r.violation_description || r.violation_type || ''), cls: 'desc' },
        { h: 'Owed', f: (r) => (n(r.balance_due) ? money(r.balance_due) : '') },
      ], { page: 8, empty: 'No ECB violations.' });
    })
    .catch((e) => { $('#dob-ecb').innerHTML = errBox(e); glanceErr('ecbDue'); });

  binQ(() => soql(DS.dobComp, { select: 'complaint_number,status,date_entered,complaint_category,unit,disposition_date,disposition_code,inspection_date', where: `bin='${bin}'`, limit: 2000 }))
    .then((rows) => {
      if (!rows) return;
      rows.sort(byDateDesc('date_entered'));
      table($('#dob-c'), rows, [
        { h: 'Entered', f: (r) => fmtDate(r.date_entered) },
        { h: 'Status', f: (r) => (r.status === 'ACTIVE' ? pill('Active', 'warn') : esc(titleCase(r.status))) },
        { h: 'Category', f: (r) => esc(dobCategory(r.complaint_category)), cls: 'desc' },
        { h: 'Disposition', f: (r) => `${esc(r.disposition_code || '')} ${r.disposition_date ? '<span class="muted">' + fmtDate(r.disposition_date) + '</span>' : ''}` },
        { h: 'Complaint #', f: (r) => `<a href="https://a810-bisweb.nyc.gov/bisweb/OverviewForComplaintServlet?complaintno=${encodeURIComponent(r.complaint_number)}&requestid=0" target="_blank" rel="noopener">${esc(r.complaint_number)}</a>` },
      ], { page: 8, empty: 'No DOB complaints.' });
    })
    .catch((e) => ($('#dob-c').innerHTML = errBox(e)));

  Promise.all([
    binQ(() => soql(DS.dobNowPermits, { select: 'job_filing_number,work_type,permit_status,issued_date,expired_date,job_description,estimated_job_costs', where: `bin='${bin}'`, order: 'issued_date DESC', limit: 500 })).catch(() => []),
    binQ(() => soql(DS.dobNowJobs, { select: 'job_filing_number,job_type,filing_date,filing_status,job_description,initial_cost', where: `bin='${bin}'`, order: 'filing_date DESC', limit: 500 })).catch(() => []),
    soql(DS.dobPermits, { select: 'job__,job_type,work_type,permit_status,permit_type,filing_date,issuance_date,expiration_date', where: `borough='${BORO_NAME[p.boro]}' AND block='${p.block}' AND lot='${p.lot.padStart(5, '0')}'`, limit: 1000 }).catch(() => []),
  ]).then(([nowP, nowJ, legacy]) => {
    nowP = nowP || []; nowJ = nowJ || [];
    const rows = [
      ...nowJ.map((r) => ({ date: normDate(r.filing_date), src: 'DOB NOW filing', id: r.job_filing_number, what: r.job_type, desc: r.job_description, status: r.filing_status, cost: r.initial_cost })),
      ...nowP.map((r) => ({ date: normDate(r.issued_date), src: 'DOB NOW permit', id: r.job_filing_number, what: r.work_type, desc: r.job_description, status: r.permit_status, cost: r.estimated_job_costs })),
      ...legacy.map((r) => ({ date: normDate(r.issuance_date || r.filing_date), src: 'BIS permit', id: r.job__, what: [jobType(r.job_type), r.work_type].filter(Boolean).join(' · '), desc: '', status: r.permit_status, cost: '' })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    table($('#dob-p'), rows, [
      { h: 'Date', f: (r) => fmtDate(r.date) },
      { h: 'Source', f: (r) => esc(r.src) },
      { h: 'Work', f: (r) => esc(r.what || '') },
      { h: 'Description', f: (r) => esc(r.desc || ''), cls: 'desc' },
      { h: 'Status', f: (r) => esc(r.status || '') },
      { h: 'Est. cost', f: (r) => (n(r.cost) ? money(r.cost) : '') },
    ], { page: 10, empty: 'No permits or job filings.' });
  });
}
function jobType(c) { return { NB: 'New building', A1: 'Major alteration', A2: 'Alteration', A3: 'Minor alteration', DM: 'Demolition', SG: 'Sign' }[c] || c; }
function dobCategory(c) {
  // A few common DOB complaint category codes; others link through to BIS for the full text.
  const m = {
    '05': 'Permit – none', '10': 'Debris / building falling or in danger of falling', '30': 'Building shaking / structural stability',
    '31': 'Certificate of occupancy – none / contrary to CO', '37': 'Egress – locked / blocked / improper', '45': 'Illegal conversion',
    '4A': 'Illegal hotel rooms in residential building', '4G': 'Illegal conversion – no access follow-up', '56': 'Boiler – fumes / smoke / carbon monoxide',
    '58': 'Boiler – defective / inoperative / no permit', '59': 'Electrical wiring – defective / exposed', '63': 'Elevator – danger condition',
    '6M': 'Elevator – multiple devices on property', '6S': 'Elevator – single device / no alternate service',
    '66': 'Plumbing work – illegal / no permit', '71': 'SRO – illegal work / change in occupancy', '73': 'Failure to maintain',
    '83': 'Construction contrary to approved plans/permits', '86': 'Work contrary to stop work order',
  };
  return m[c] ? `${m[c]} (${c})` : `Category ${c || '?'} (see BIS)`;
}

// ---------- 311 ----------
async function load311(p) {
  const body = $('#s311-body');
  const yr = daysAgoISO(365), yr3 = daysAgoISO(365 * 3);
  body.innerHTML = `
    <div class="two">
      <div><h3>At this building (last 3 years)</h3><div id="s-bldg">${loading()}</div></div>
      <div><h3>Within ~1 block (250 m), last 12 months</h3><div id="s-near">${loading()}</div></div>
    </div>
    <h3>Recent requests at this building</h3><div id="s-list">${loading()}</div>
    <p class="note">Heat, plumbing and pest complaints at a building are routed to HPD and also appear in the HPD section above. Noise and street conditions show what living on the block is like.</p>`;

  soql(DS.sr311, { select: 'complaint_type, count(*) as n', where: `bbl='${p.bbl}' AND created_date>'${yr3}'`, group: 'complaint_type', order: 'n DESC', limit: 20 })
    .then((rows) => ($('#s-bldg').innerHTML = bars(rows.map((r) => ({ label: r.complaint_type, n: n(r.n) })))))
    .catch((e) => ($('#s-bldg').innerHTML = errBox(e)));

  soql(DS.sr311, { select: 'count(*) as n', where: `bbl='${p.bbl}' AND created_date>'${yr}' AND complaint_type='HEAT/HOT WATER'` })
    .then((rows) => { const h = n(rows[0] && rows[0].n); setGlance('heat', fmtN(h), h > 50 ? 'bad' : h > 5 ? 'warn' : 'ok'); })
    .catch(() => glanceErr('heat'));

  soql(DS.sr311, { select: 'complaint_type, count(*) as n', where: `within_circle(location, ${p.lat}, ${p.lon}, 250) AND created_date>'${yr}'`, group: 'complaint_type', order: 'n DESC', limit: 15 })
    .then((rows) => ($('#s-near').innerHTML = bars(rows.map((r) => ({ label: r.complaint_type, n: n(r.n) })), { max: 15 })))
    .catch((e) => ($('#s-near').innerHTML = errBox(e)));

  soql(DS.sr311, { select: 'created_date,closed_date,agency,complaint_type,descriptor,status,resolution_description', where: `bbl='${p.bbl}' AND created_date>'${yr3}'`, order: 'created_date DESC', limit: 1000 })
    .then((rows) => table($('#s-list'), rows, [
      { h: 'Date', f: (r) => fmtDate(r.created_date) },
      { h: 'Agency', f: (r) => esc(r.agency) },
      { h: 'Complaint', f: (r) => `${esc(r.complaint_type)}${r.descriptor ? ' — ' + esc(r.descriptor) : ''}` },
      { h: 'Status', f: (r) => esc(r.status) },
      { h: 'Resolution', f: (r) => esc(r.resolution_description || ''), cls: 'desc' },
    ], { page: 10, empty: 'No 311 requests at this building in the last 3 years.' }))
    .catch((e) => ($('#s-list').innerHTML = errBox(e)));
}

// ---------- Crime ----------
let map, layer;
let cityYtd = null; // { total, from, to }
const LAW_COLOR = { FELONY: '#d32f2f', MISDEMEANOR: '#f39c12', VIOLATION: '#8e99a8' };

function initCrime(p) {
  if (map) { map.remove(); map = null; }
  if (window.L) {
    map = L.map('map', { scrollWheelZoom: false }).setView([p.lat, p.lon], 16);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  } else {
    $('#map').innerHTML = '<p class="note" style="padding:12px">Map library failed to load.</p>';
  }
  $('#radius-tabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#radius-tabs button').forEach((x) => x.setAttribute('aria-pressed', x === b));
    loadCrime(p, Number(b.dataset.r));
  };
  loadCrime(p, 400, true);
}

async function getCityYtd() {
  if (cityYtd) return cityYtd;
  const r = await soql(DS.crimeYtd, { select: 'count(*) as n, min(rpt_dt) as a, max(rpt_dt) as b', where: 'lat_lon IS NOT NULL' });
  cityYtd = { total: n(r[0].n), from: normDate(r[0].a), to: normDate(r[0].b) };
  return cityYtd;
}

async function loadCrime(p, radius, setGlanceStat = false) {
  const body = $('#crime-body');
  body.innerHTML = loading('Loading crime data…');
  const circle = `within_circle(lat_lon, ${p.lat}, ${p.lon}, ${radius})`;
  if (layer) {
    layer.clearLayers();
    L.circle([p.lat, p.lon], { radius, color: '#1f5fbf', weight: 1.5, fillOpacity: 0.04 }).addTo(layer);
    L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#1f5fbf', fillOpacity: 1 }).addTo(layer).bindPopup(esc(p.label));
    map.fitBounds(L.latLng(p.lat, p.lon).toBounds(radius * 2.2));
  }
  try {
    const city = await getCityYtd();
    const year = city.to.slice(0, 4);
    const prev = String(Number(year) - 1);
    const [cats, offs, pts] = await Promise.all([
      soql(DS.crimeYtd, { select: 'law_cat_cd, count(*) as n', where: circle, group: 'law_cat_cd' }),
      soql(DS.crimeYtd, { select: 'ofns_desc, count(*) as n', where: circle, group: 'ofns_desc', order: 'n DESC', limit: 15 }),
      soql(DS.crimeYtd, { select: 'cmplnt_fr_dt,ofns_desc,pd_desc,law_cat_cd,prem_typ_desc,latitude,longitude', where: circle, order: 'cmplnt_fr_dt DESC', limit: 5000 }),
    ]);
    const c = Object.fromEntries(cats.map((r) => [r.law_cat_cd, n(r.n)]));
    const local = cats.reduce((s, r) => s + n(r.n), 0);
    const expected = city.total * (Math.PI * radius * radius) / NYC_LAND_M2;
    const ratio = expected ? local / expected : 0;
    const lvl = ratio >= 2 ? 'bad' : ratio >= 1.2 ? 'warn' : 'ok';
    const ratioTxt = ratio ? `${ratio.toFixed(1)}×` : '—';
    if (radius === 400) setGlance('crime', ratioTxt, lvl, `Crime vs. NYC average (¼ mile, ${year} to date)`);
    else if (setGlanceStat) setGlance('crime', ratioTxt, lvl);

    body.innerHTML = `
      <div class="glance" style="margin-top:8px">
        <div class="stat ${lvl}"><div class="n">${ratioTxt}</div><div class="l">vs. the NYC average for an area this size</div></div>
        <div class="stat"><div class="n">${fmtN(c.FELONY)}</div><div class="l">Felonies, ${esc(year)} to date</div></div>
        <div class="stat"><div class="n">${fmtN(c.MISDEMEANOR)}</div><div class="l">Misdemeanors, ${esc(year)} to date</div></div>
        <div class="stat"><div class="n">${fmtN(c.VIOLATION)}</div><div class="l">Violations, ${esc(year)} to date</div></div>
        <div class="stat" id="crime-prev"><div class="n"><span class="spin"></span></div><div class="l">All reports in ${esc(prev)} (same radius)</div></div>
      </div>
      <p class="note">Reports from ${fmtDate(city.from)} to ${fmtDate(city.to)} (NYPD publishes quarterly). The average is citywide reports ÷ NYC land area — busy commercial areas and transit hubs always run high, so compare similar neighborhoods. Locations are moved to the nearest intersection or block midpoint for privacy.</p>
      <div class="two">
        <div><h3>Most common offenses</h3>${bars(offs.map((r) => ({ label: titleCase(r.ofns_desc || 'Unknown'), n: n(r.n) })), { max: 15 })}</div>
        <div><h3>Most recent reports</h3><div id="crime-list"></div></div>
      </div>`;

    table($('#crime-list'), pts, [
      { h: 'Date', f: (r) => fmtDate(r.cmplnt_fr_dt) },
      { h: 'Offense', f: (r) => `<span class="dot" style="background:${LAW_COLOR[r.law_cat_cd] || '#999'}"></span>${esc(titleCase(r.ofns_desc || r.pd_desc))}` },
      { h: 'Premises', f: (r) => esc(titleCase(r.prem_typ_desc || '')) },
    ], { page: 10, filter: true, empty: 'No reports in this radius.' });

    if (layer) {
      for (const r of pts) {
        const la = Number(r.latitude), lo = Number(r.longitude);
        if (!la || !lo) continue;
        L.circleMarker([la, lo], { radius: 4, weight: 0, fillColor: LAW_COLOR[r.law_cat_cd] || '#999', fillOpacity: 0.65 })
          .bindPopup(`<b>${esc(titleCase(r.ofns_desc || ''))}</b><br>${esc(titleCase(r.pd_desc || ''))}<br>${fmtDate(r.cmplnt_fr_dt)} · ${esc(titleCase(r.prem_typ_desc || ''))}`)
          .addTo(layer);
      }
    }

    soql(DS.crimeHist, { select: 'count(*) as n', where: `${circle} AND rpt_dt between '${prev}-01-01T00:00:00' and '${prev}-12-31T23:59:59'` })
      .then((r) => { const el = $('#crime-prev'); if (el) $('.n', el).textContent = fmtN(r[0] && r[0].n); })
      .catch(() => { const el = $('#crime-prev'); if (el) $('.n', el).textContent = '—'; });
  } catch (e) {
    body.innerHTML = errBox(e);
    if (setGlanceStat) glanceErr('crime');
  }
}

// ---------- Rent stabilization ----------
function renderRentStab(p, info) {
  const pl = info.pluto || {};
  const year = n(pl.yearbuilt), units = n(pl.unitsres), cls = pl.bldgclass || '';
  const coop = /^(C6|C8|D0|D4|R9|R[0-9A-Z])/.test(cls) && !/^RR/.test(cls);
  let v, head, why;
  if (!units) {
    v = 'unlikely'; head = 'Unknown'; why = 'City records don’t list residential units for this lot.';
  } else if (units < 6) {
    v = 'unlikely'; head = 'Unlikely';
    why = `This building has ${units} residential unit${units === 1 ? '' : 's'}. Rent stabilization generally covers buildings with 6 or more units (unless the building receives certain tax benefits).`;
  } else if (year && year < 1974) {
    v = 'likely'; head = 'Likely candidate';
    why = `Built in ${year} with ${units} units. Most NYC buildings with 6+ units built before 1974 have rent-stabilized apartments. Before 2019 many units were deregulated (high-rent vacancy decontrol), so an individual apartment may or may not still be covered.`;
  } else if (year) {
    v = 'maybe'; head = 'Possible';
    why = `Built in ${year} with ${units} units. Buildings built in 1974 or later are stabilized only if they received tax benefits such as 421-a, J-51 or 485-x — common for new rentals, but you have to check.`;
  } else {
    v = 'maybe'; head = 'Possible'; why = `${units} units, year built unknown.`;
  }
  if (coop) why += ' This is a co-op/condo building: units owned by individuals are usually not stabilized, but sponsor-held rentals and long-time tenants can be.';

  $('#rs-body').innerHTML = `
    <div class="verdict ${v}"><b>${esc(head)}</b>${esc(why)}</div>
    <p class="note">This is an estimate from building age and size, not an official determination. DHCR has no public lookup API. To confirm:</p>
    <ol class="note">
      <li>Check the building on <a href="https://rentguidelinesboard.cityofnewyork.us/resources/rent-stabilized-building-lists/" target="_blank" rel="noopener">DHCR’s rent-stabilized building lists</a> (published via the Rent Guidelines Board, by borough).</li>
      <li>See the stabilized-unit count from tax bills on <a href="https://whoownswhat.justfix.org/en/bbl/${esc(p.bbl)}" target="_blank" rel="noopener">Who Owns What</a>, along with the landlord’s other buildings.</li>
      <li>Ask the landlord for the lease rider, or request the apartment’s rent history from <a href="https://hcr.ny.gov/" target="_blank" rel="noopener">NYS HCR (DHCR)</a> — tenants can request it for free.</li>
    </ol>`;
}

// ---------- restore from URL ----------
(function restore() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('bbl') && qs.get('lat')) {
    const place = { label: qs.get('q') || '', bbl: qs.get('bbl'), bin: qs.get('bin') || '', lat: Number(qs.get('lat')), lon: Number(qs.get('lon')), borough: '', neighbourhood: '', apt: qs.get('apt') || '' };
    addrEl.value = place.label; aptEl.value = place.apt;
    run(place);
  } else if (qs.get('q')) {
    addrEl.value = qs.get('q');
    aptEl.value = qs.get('apt') || '';
    $('#search').requestSubmit();
  }
})();
