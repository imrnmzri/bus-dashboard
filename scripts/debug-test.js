// Debug test: trace getStopsForRoute and getLiveETA for T601 and T541
var zlib = require('zlib');
var fs = require('fs');

var buf = fs.readFileSync('data/static.json.gz');
zlib.gunzip(buf, function(err, data) {
  if (err) throw err;
  var raw = JSON.parse(data.toString());
  
  // Expand short keys to full names (copy of gtfs-static.js logic)
  var routes = {}, stops = {}, trips = {}, shapes = {};
  for (var rid in raw.R) {
    routes[rid] = { route_id: rid, short_name: raw.R[rid].sn, long_name: raw.R[rid].ln };
  }
  for (var sid in raw.S) {
    stops[sid] = { stop_id: sid, name: raw.S[sid].n, lat: raw.S[sid].lat, lon: raw.S[sid].lng };
  }
  for (var tid in raw.T) {
    var t = raw.T[tid];
    trips[tid] = {
      trip_id: tid, route_id: t.r, shape_id: t.sh, direction_id: t.d,
      stop_times: (t.st || []).map(function(st) { return { stop_id: st.s, arrival_seconds: st.a, departure_seconds: st.d, sequence: st.seq }; })
    };
  }
  for (var hid in raw.H) { shapes[hid] = raw.H[hid]; }
  var staticData = { routes: routes, stops: stops, trips: trips, shapes: shapes, _nameIndex: raw.I };

  // ---- OLD getStopsForRoute (current broken version) ----
  function oldGetStopsForRoute(routeId) {
    var stopMap = {}, orderMap = {};
    var firstTrip = null;
    for (var tid in trips) {
      if (trips[tid].route_id === routeId && trips[tid].stop_times && trips[tid].stop_times.length > 0) {
        firstTrip = trips[tid]; break;
      }
    }
    if (!firstTrip) return [];
    for (var i = 0; i < firstTrip.stop_times.length; i++) {
      var st = firstTrip.stop_times[i];
      if (!st.stop_id || stopMap[st.stop_id]) continue;
      stopMap[st.stop_id] = true;
      orderMap[st.stop_id] = i;
    }
    // BUG: merges stops from ALL other trips
    for (var tid2 in trips) {
      if (trips[tid2].route_id !== routeId) continue;
      var times = trips[tid2].stop_times;
      if (!times) continue;
      for (var j = 0; j < times.length; j++) {
        var sid = times[j].stop_id;
        if (!sid || stopMap[sid]) continue;
        stopMap[sid] = true;
        orderMap[sid] = j;
      }
    }
    var result = [];
    for (var sid in stopMap) {
      var s = stops[sid];
      result.push({ stop_id: sid, name: s ? s.name : sid, order: orderMap[sid] !== undefined ? orderMap[sid] : 9999 });
    }
    result.sort(function(a, b) { return a.order - b.order; });
    return result;
  }

  // ---- NEW getStopsForRoute (single-trip, direction-aware) ----
  function newGetStopsForRoute(routeId, stopId) {
    var stopMap = {}, orderMap = {};
    var targetTrip = null;
    for (var tid in trips) {
      if (trips[tid].route_id !== routeId) continue;
      if (!trips[tid].stop_times || trips[tid].stop_times.length === 0) continue;
      if (!targetTrip) targetTrip = trips[tid];
      if (stopId) {
        for (var j = 0; j < trips[tid].stop_times.length; j++) {
          if (trips[tid].stop_times[j].stop_id === stopId) {
            targetTrip = trips[tid]; break;
          }
        }
      }
    }
    if (!targetTrip) return [];
    for (var i = 0; i < targetTrip.stop_times.length; i++) {
      var st = targetTrip.stop_times[i];
      if (!st.stop_id || stopMap[st.stop_id]) continue;
      stopMap[st.stop_id] = true;
      orderMap[st.stop_id] = i;
    }
    var result = [];
    for (var sid in stopMap) {
      var s = stops[sid];
      result.push({ stop_id: sid, name: s ? s.name : sid, order: orderMap[sid] !== undefined ? orderMap[sid] : 9999 });
    }
    result.sort(function(a, b) { return a.order - b.order; });
    return result;
  }

  // ---- Haversine ----
  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ---- Closest on shape ----
  function closestOnShape(lat, lng, shape, cumDist, startSeg) {
    var bestDist = Infinity;
    var bestCum = 0;
    var bestSeg = startSeg || 0;
    var s = startSeg || 0;
    for (var i = s; i < shape.length - 1; i++) {
      var aLat = shape[i].lat, aLng = shape[i].lng;
      var bLat = shape[i + 1].lat, bLng = shape[i + 1].lng;
      var dx = bLng - aLng, dy = bLat - aLat;
      var segLenSq = dx * dx + dy * dy;
      var t;
      if (segLenSq === 0) { t = 0; }
      else {
        t = ((lng - aLng) * dx + (lat - aLat) * dy) / segLenSq;
        if (t < 0) t = 0; if (t > 1) t = 1;
      }
      var projLat = aLat + t * dy;
      var projLng = aLng + t * dx;
      var d = haversine(lat, lng, projLat, projLng);
      if (d < bestDist) { bestDist = d; bestCum = cumDist[i] + t * (cumDist[i + 1] - cumDist[i]); bestSeg = i; }
    }
    return { distance: bestCum, snapDist: bestDist, seg: bestSeg };
  }

  function buildCumDist(shape) {
    var cum = [0];
    for (var i = 1; i < shape.length; i++) {
      cum.push(cum[i - 1] + haversine(shape[i - 1].lat, shape[i - 1].lng, shape[i].lat, shape[i].lng));
    }
    return cum;
  }

  // ==========================================
  // TEST 1: T601 stop ordering
  // ==========================================
  console.log('========================================');
  console.log('TEST 1: T601 (T6010) stop ordering');
  console.log('========================================\n');

  var oldT601 = oldGetStopsForRoute('T6010');
  console.log('OLD getStopsForRoute for T6010: ' + oldT601.length + ' stops');
  console.log('  Order: ' + oldT601.map(function(s) { return s.name; }).join(' → '));
  console.log('');

  var newT601 = newGetStopsForRoute('T6010');
  console.log('NEW getStopsForRoute for T6010 (no stopId): ' + newT601.length + ' stops');
  console.log('  Order: ' + newT601.map(function(s) { return s.name; }).join(' → '));
  console.log('');

  // Pick a stop from dir 0 (T601002)
  var dir0Stop = '1002924'; // from dir 0 first trip
  var newT601Dir0 = newGetStopsForRoute('T6010', dir0Stop);
  console.log('NEW getStopsForRoute for T6010 (stopId=' + dir0Stop + '): ' + newT601Dir0.length + ' stops');
  console.log('  Order: ' + newT601Dir0.map(function(s) { return s.name; }).join(' → '));
  console.log('');

  // Pick a stop from dir 1 (T601001)
  var dir1Stop = '1006576'; // from dir 1 first trip
  var newT601Dir1 = newGetStopsForRoute('T6010', dir1Stop);
  console.log('NEW getStopsForRoute for T6010 (stopId=' + dir1Stop + '): ' + newT601Dir1.length + ' stops');
  console.log('  Order: ' + newT601Dir1.map(function(s) { return s.name; }).join(' → '));
  console.log('');

  // ==========================================
  // TEST 2: T541 ETA — simulate bus on loop
  // ==========================================
  console.log('========================================');
  console.log('TEST 2: T541 (U5410) ETA — loop snaping');
  console.log('========================================\n');

  var shape541 = shapes['U541002'];
  var cum541 = buildCumDist(shape541);
  console.log('Shape U541002: ' + shape541.length + ' points, total length: ' + cum541[cum541.length-1].toFixed(2) + ' km');
  console.log('Start: ' + shape541[0].lat.toFixed(4) + ',' + shape541[0].lng.toFixed(4));
  console.log('End:   ' + shape541[shape541.length-1].lat.toFixed(4) + ',' + shape541[shape541.length-1].lng.toFixed(4));
  console.log('Start-end distance: ' + haversine(shape541[0].lat, shape541[0].lng, shape541[shape541.length-1].lat, shape541[shape541.length-1].lng).toFixed(3) + ' km');
  console.log('');

  // Simulate: bus GPS near the start of the loop (but actually at the END of the loop, about to complete)
  // Bus is physically at the start point but has traveled the full loop
  var startLat = shape541[0].lat;
  var startLng = shape541[0].lng;
  
  // What does closestOnShape give for a bus at the start coordinates?
  var atStart = closestOnShape(startLat, startLng, shape541, cum541);
  console.log('Bus GPS at shape START coordinates:');
  console.log('  closestOnShape distance: ' + atStart.distance.toFixed(3) + ' km of ' + cum541[cum541.length-1].toFixed(2) + ' km total');
  console.log('  snapDist: ' + (atStart.snapDist * 1000).toFixed(1) + 'm');
  console.log('');

  // Simulate: bus GPS near midpoint of loop
  var midIdx = Math.floor(shape541.length / 2);
  var atMid = closestOnShape(shape541[midIdx].lat, shape541[midIdx].lng, shape541, cum541);
  console.log('Bus GPS at shape MIDPOINT:');
  console.log('  closestOnShape distance: ' + atMid.distance.toFixed(3) + ' km of ' + cum541[cum541.length-1].toFixed(2) + ' km');
  console.log('');

  // Simulate: bus slightly after the start (like +0.0001 lat, typical bus movement)
  // This is the key test — if the bus has gone 99% of the loop and is near the start physically,
  // closestOnShape will snap to ~0km instead of ~totalLength km
  var nearEndLat = shape541[shape541.length - 10].lat;
  var nearEndLng = shape541[shape541.length - 10].lng;
  var atNearEnd = closestOnShape(nearEndLat, nearEndLng, shape541, cum541);
  console.log('Bus GPS at shape position [-10] (near end of loop):');
  console.log('  Shape index: ' + (shape541.length - 10));
  console.log('  closestOnShape distance: ' + atNearEnd.distance.toFixed(3) + ' km');
  console.log('  Expected ~' + cum541[shape541.length - 10].toFixed(3) + ' km');
  console.log('  Match? ' + (Math.abs(atNearEnd.distance - cum541[shape541.length - 10]) < 0.1 ? 'YES' : 'NO - OFF BY ' + Math.abs(atNearEnd.distance - cum541[shape541.length - 10]).toFixed(3) + ' km'));
  console.log('');

  // Simulate: bus at the very last point
  var lastIdx = shape541.length - 1;
  var atLast = closestOnShape(shape541[lastIdx].lat, shape541[lastIdx].lng, shape541, cum541);
  console.log('Bus GPS at shape LAST point:');
  console.log('  Expected distance: ' + cum541[lastIdx].toFixed(3) + ' km');
  console.log('  closestOnShape distance: ' + atLast.distance.toFixed(3) + ' km');
  
  // Now test: a stop near the end. Pick the last stop in the list.
  // Get the stop coordinates for the last stop
  var trip541 = null;
  for (var tid in trips) {
    if (trips[tid].route_id === 'U5410') { trip541 = trips[tid]; break; }
  }
  if (trip541) {
    var lastStop = trip541.stop_times[trip541.stop_times.length - 1];
    var lastStopData = stops[lastStop.stop_id];
    var firstStop = trip541.stop_times[0];
    var firstStopData = stops[firstStop.stop_id];
    
    console.log('');
    console.log('Last stop: ' + lastStopData.name + ' (' + lastStopData.lat.toFixed(4) + ',' + lastStopData.lon.toFixed(4) + ')');
    console.log('First stop: ' + firstStopData.name + ' (' + firstStopData.lat.toFixed(4) + ',' + firstStopData.lon.toFixed(4) + ')');
    console.log('Direct distance between stops: ' + haversine(firstStopData.lat, firstStopData.lon, lastStopData.lat, lastStopData.lon).toFixed(3) + ' km');
    
    // Map stops to shape using monotonic projection
    console.log('');
    console.log('--- STOP PROJECTION (BUG B monotonic) ---');
    var prevSeg = 0;
    for (var si = 0; si < trip541.stop_times.length; si++) {
      var st = trip541.stop_times[si];
      var sd = stops[st.stop_id];
      if (!sd) continue;
      var snap = closestOnShape(sd.lat, sd.lon, shape541, cum541, prevSeg);
      prevSeg = snap.seg;
      if (si === 0 || si === trip541.stop_times.length - 1 || si % 10 === 0) {
        console.log('  [' + si + '] ' + sd.name + ': shape_dist=' + snap.distance.toFixed(3) + ' km, snapDist=' + (snap.snapDist * 1000).toFixed(0) + 'm');
      }
    }
  }
});
