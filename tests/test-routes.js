const zlib = require('zlib');
const fs = require('fs');

const buf = fs.readFileSync('data/static.json.gz');
const raw = zlib.gunzipSync(buf).toString('utf8');
const data = JSON.parse(raw);

const routes = {}, stops = {}, trips = {}, shapes = {}, frequencies = {};
const index = data.I || {};

for (const rid in data.R) {
    const r = data.R[rid];
    routes[rid] = { route_id: rid, short_name: r.sn, long_name: r.ln };
}
for (const sid in data.S) {
    const s = data.S[sid];
    stops[sid] = { stop_id: sid, name: s.n, lat: s.lat, lon: s.lng };
}
for (const tid in data.T) {
    const t = data.T[tid];
    const stArr = (t.st || []).map(s => ({ stop_id: s.s, arrival_seconds: s.a, departure_seconds: s.d, sequence: s.seq }));
    trips[tid] = { route_id: t.r, shape_id: t.sh, direction_id: t.d, service_id: t.sv, stop_times: stArr };
}
for (const hid in data.H) {
    shapes[hid] = data.H[hid].map(p => ({ lat: p.lat, lng: p.lng }));
}
if (data.F) {
    for (const rid in data.F) {
        frequencies[rid] = data.F[rid].map(f => ({
            start_seconds: f.s, end_seconds: f.e, headway_secs: f.h, exact_times: f.x
        }));
    }
}

const expanded = { routes, stops, trips, shapes, frequencies, calendar: data.C, calendarDates: data.CD, _nameIndex: index };

function findByShortName(sn) {
    for (const rid in routes) {
        if (routes[rid].short_name === sn || routes[rid].long_name === sn) return rid;
    }
    if (index[sn]) return index[sn];
    return null;
}

function getDepartures(routeId, staticData) {
    const deps = new Set();
    for (const tid in staticData.trips) {
        const t = staticData.trips[tid];
        if (t.route_id !== routeId) continue;
        if (!t.stop_times || t.stop_times.length === 0) continue;
        const sorted = t.stop_times.slice().sort((a, b) => a.sequence - b.sequence);
        deps.add(sorted[0].departure_seconds);
    }
    return Array.from(deps).sort((a, b) => a - b);
}

function getStopSequence(routeId, staticData) {
    for (const tid in staticData.trips) {
        const t = staticData.trips[tid];
        if (t.route_id !== routeId) continue;
        if (!t.stop_times || t.stop_times.length === 0) continue;
        return t.stop_times.slice().sort((a, b) => a.sequence - b.sequence)
            .map(st => ({ id: st.stop_id, name: (staticData.stops[st.stop_id] || {}).name || st.stop_id }));
    }
    return [];
}

var passed = 0, failed = 0;
function check(cond, msg) {
    if (cond) { passed++; }
    else { failed++; console.error('  FAIL: ' + msg); }
}

// ─── T808 ───

console.log('═══ T808 ═══');

const t808id = findByShortName('T808');
check(t808id !== null, 'T808 found in static data');
console.log('  route_id: ' + t808id);

const t808Deps = getDepartures(t808id, expanded);
console.log('  unique departures: ' + t808Deps.length);
check(t808Deps.length > 0, 'T808 has departures');

const t808FirstTime = t808Deps[0];
const t808FirstH = Math.floor(t808FirstTime / 3600) % 24;
console.log('  first departure: ' + String(t808FirstH).padStart(2, '0') + ':' + String(Math.floor((t808FirstTime % 3600) / 60)).padStart(2, '0'));
check(t808FirstH >= 5 && t808FirstH <= 7, 'first departure is early morning (5-7AM)');

const t808LastTime = t808Deps[t808Deps.length - 1];
const t808LastH = Math.floor(t808LastTime / 3600) % 24;
console.log('  last departure: ' + String(t808LastH).padStart(2, '0') + ':' + String(Math.floor((t808LastTime % 3600) / 60)).padStart(2, '0'));
check(t808LastH >= 22, 'last departure is late night');

const t808Stops = getStopSequence(t808id, expanded);
console.log('  stops: ' + t808Stops.length);
check(t808Stops.length >= 8, 'T808 has at least 8 stops');
check(t808Stops[0].name.includes('MRT SURIAN'), 'first stop is MRT Surian');

// Check T808 is NOT frequency-based
const t808Freq = frequencies[t808id];
check(!t808Freq || t808Freq.every(f => f.exact_times !== 0), 'T808 is timetabled (not frequency-based)');

// ─── T581 ───

console.log('');
console.log('═══ T581 ═══');

const t581id = findByShortName('T581');
check(t581id !== null, 'T581 found in static data');
console.log('  route_id: ' + t581id);

const t581Freq = frequencies[t581id] || [];
check(t581Freq.length > 0, 'T581 has frequency entries');
check(t581Freq.some(f => f.exact_times === 0), 'T581 is frequency-based');

const t581Stops = getStopSequence(t581id, expanded);
console.log('  stops: ' + t581Stops.length);
check(t581Stops.length >= 15, 'T581 has at least 15 stops');

// Show frequency windows
t581Freq.forEach(f => {
    const sh = Math.floor(f.start_seconds / 3600);
    const sm = Math.floor((f.start_seconds % 3600) / 60);
    const eh = Math.floor(f.end_seconds / 3600);
    const em = Math.floor((f.end_seconds % 3600) / 60);
    console.log('  ' + String(sh).padStart(2, '0') + ':' + String(sm).padStart(2, '0') +
        ' - ' + String(eh).padStart(2, '0') + ':' + String(em).padStart(2, '0') +
        ' | ' + (f.headway_secs / 60).toFixed(0) + 'min');
    check(f.headway_secs >= 600 && f.headway_secs <= 3600, 'headway is reasonable (10-60 min)');
});

// Check next departure computation (frequency-based)
const now = new Date();
const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
let nextDep = null;
for (const f of t581Freq) {
    const ws = f.start_seconds, we = f.end_seconds, hw = f.headway_secs;
    const windows = [{ s: ws, e: we }, { s: ws + 86400, e: we + 86400 }];
    for (const w of windows) {
        const k = Math.max(0, Math.ceil((nowSeconds - w.s) / hw));
        const departure = w.s + k * hw;
        if (departure >= nowSeconds && departure <= w.e) {
            if (nextDep === null || departure < nextDep) nextDep = departure;
        }
    }
}
check(nextDep !== null, 'next departure computable from frequency');
if (nextDep !== null) {
    const h = Math.floor(nextDep / 3600) % 24;
    const m = Math.floor((nextDep % 3600) / 60);
    console.log('  computed next departure: ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
}

console.log('');
console.log('=== ' + passed + ' passed, ' + failed + ' failed ===');
if (failed > 0) process.exit(1);
