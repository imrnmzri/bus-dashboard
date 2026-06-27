var JSZip = require('jszip');
var Papa = require('papaparse');
var fs = require('fs');
var path = require('path');

var CATEGORIES = ['rapid-bus-kl', 'rapid-bus-mrtfeeder'];
var STATIC_BASE = 'https://api.data.gov.my/gtfs-static/prasarana?category=';

function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  var parts = timeStr.split(':').map(Number);
  return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
}

function parseCSV(zip, filename) {
  var file = zip.file(filename);
  if (!file) return Promise.resolve([]);
  return file.async('string').then(function(text) {
    return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  });
}

async function downloadAndProcess(category) {
  var url = STATIC_BASE + category;
  console.log('Downloading ' + category + '...');
  var resp = await fetch(url);
  var blob = await resp.arrayBuffer();
  console.log('  Downloaded: ' + (blob.byteLength / 1024 / 1024).toFixed(1) + ' MB');
  var zip = await JSZip.loadAsync(Buffer.from(blob));

  var results = await Promise.all([
    parseCSV(zip, 'routes.txt'),
    parseCSV(zip, 'trips.txt'),
    parseCSV(zip, 'stop_times.txt'),
    parseCSV(zip, 'stops.txt'),
    parseCSV(zip, 'shapes.txt'),
    parseCSV(zip, 'frequencies.txt')
  ]);

  return {
    routes: results[0], trips: results[1], stopTimes: results[2],
    stops: results[3], shapes: results[4], frequencies: results[5], category: category
  };
}

function merge(all) {
  var routes = {}, stops = {}, trips = {}, shapes = {};
  var stopTimesByTrip = {};

  all.forEach(function(r) {
    console.log('  ' + r.category + ': ' + r.routes.length + ' routes, ' + r.stops.length + ' stops, ' + r.trips.length + ' trips');

    r.routes.forEach(function(rt) {
      if (!rt.route_id || routes[rt.route_id]) return;
      routes[rt.route_id] = {
        sn: (rt.route_short_name || '').trim(),
        ln: (rt.route_long_name || '').trim()
      };
    });

    r.stops.forEach(function(s) {
      if (!s.stop_id || stops[s.stop_id]) return;
      stops[s.stop_id] = {
        n: (s.stop_name || '').trim(),
        lat: parseFloat(s.stop_lat) || 0,
        lng: parseFloat(s.stop_lon) || 0
      };
    });

    r.stopTimes.forEach(function(st) {
      if (!st.trip_id) return;
      if (!stopTimesByTrip[st.trip_id]) stopTimesByTrip[st.trip_id] = [];
      stopTimesByTrip[st.trip_id].push({
        s: st.stop_id,
        a: timeToSeconds(st.arrival_time),
        d: timeToSeconds(st.departure_time),
        seq: parseInt(st.stop_sequence) || 0
      });
    });

    r.trips.forEach(function(t) {
      if (!t.trip_id || trips[t.trip_id]) return;
      trips[t.trip_id] = {
        r: t.route_id,
        sh: t.shape_id || null,
        d: parseInt(t.direction_id) || 0,
        st: stopTimesByTrip[t.trip_id] || []
      };
    });

    r.shapes.forEach(function(sh) {
      if (!sh.shape_id) return;
      if (!shapes[sh.shape_id]) shapes[sh.shape_id] = [];
      shapes[sh.shape_id].push({
        lat: parseFloat(sh.shape_pt_lat),
        lng: parseFloat(sh.shape_pt_lon),
        seq: parseInt(sh.shape_pt_sequence) || 0
      });
    });
  });

  // Sort
  for (var tid in trips) {
    trips[tid].st.sort(function(a, b) { return a.seq - b.seq; });
  }
  for (var sid in shapes) {
    shapes[sid].sort(function(a, b) { return a.seq - b.seq; });
  }

  // Frequencies — pre-resolve route_id and index by route
  var freqByRoute = {};
  var freqCount = 0;
  all.forEach(function(r) {
    r.frequencies.forEach(function(f) {
      if (!f.trip_id || !f.headway_secs) return;
      var trip = trips[f.trip_id];
      var routeId = trip ? trip.r : null;
      if (!routeId) return;
      if (!freqByRoute[routeId]) freqByRoute[routeId] = [];
      freqByRoute[routeId].push({
        s: timeToSeconds(f.start_time),
        e: timeToSeconds(f.end_time),
        h: parseInt(f.headway_secs) || 0,
        x: parseInt(f.exact_times) || 0
      });
      freqCount++;
    });
  });

  // Name index
  var nameIndex = {};
  for (var rid in routes) {
    nameIndex[rid] = rid;
    if (routes[rid].sn) { nameIndex[routes[rid].sn] = rid; nameIndex[routes[rid].sn.toUpperCase()] = rid; }
    if (routes[rid].ln) { nameIndex[routes[rid].ln] = rid; nameIndex[routes[rid].ln.toUpperCase()] = rid; }
  }

  console.log('Merged: ' + Object.keys(routes).length + ' routes, ' + Object.keys(stops).length + ' stops, ' + Object.keys(trips).length + ' trips, ' + Object.keys(shapes).length + ' shapes, ' + freqCount + ' frequencies on ' + Object.keys(freqByRoute).length + ' routes');
  return { R: routes, S: stops, T: trips, H: shapes, F: freqByRoute, I: nameIndex };
}

async function main() {
  console.log('Building GTFS static data...\n');
  var results = await Promise.all(CATEGORIES.map(downloadAndProcess));
  var data = merge(results);

var zlib = require('zlib');

  var outPath = path.join(__dirname, '..', 'data', 'static.json.gz');
  var json = JSON.stringify(data);
  var compressed = zlib.gzipSync(json);
  fs.writeFileSync(outPath, compressed);
  console.log('\nWritten: ' + outPath + ' (' + (compressed.length / 1024 / 1024).toFixed(1) + ' MB gzipped, was ' + (json.length / 1024 / 1024).toFixed(1) + ' MB raw)');
}

main().catch(function(e) {
  console.error('FAILED: ' + e.message);
  process.exit(1);
});
