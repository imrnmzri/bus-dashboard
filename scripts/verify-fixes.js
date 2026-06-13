// Verify fixes: run the actual fixed logic against T601 and T541
var zlib = require('zlib');
var fs = require('fs');

var buf = fs.readFileSync('data/static.json.gz');
zlib.gunzip(buf, function(err, data) {
  if (err) throw err;
  var raw = JSON.parse(data.toString());
  
  var routes = {}, stops = {}, trips = {}, shapes = {};
  for (var rid in raw.R) {
    routes[rid] = { route_id: rid, short_name: raw.R[rid].sn, long_name: raw.R[rid].ln };
  }
  for (var sid in raw.S) {
    stops[sid] = { stop_id: sid, name: raw.S[sid].n, lat: raw.S[sid].lat, lon: raw.S[sid].lng };
  }
  for (var tid in raw.T) {
    var t = raw.T[tid];
    trips[tid] = { trip_id: tid, route_id: t.r, shape_id: t.sh, direction_id: t.d,
      stop_times: (t.st || []).map(function(st) { return { stop_id: st.s, arrival_seconds: st.a, departure_seconds: st.d, sequence: st.seq }; })
    };
  }
  for (var hid in raw.H) { shapes[hid] = raw.H[hid]; }
  var staticData = { routes: routes, stops: stops, trips: trips, shapes: shapes, _nameIndex: raw.I };

  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function closestOnShape(lat, lng, shape, cumDist, startSeg) {
    var bestDist = Infinity, bestCum = 0, bestSeg = startSeg || 0;
    var s = startSeg || 0;
    for (var i = s; i < shape.length - 1; i++) {
      var aLat = shape[i].lat, aLng = shape[i].lng;
      var bLat = shape[i + 1].lat, bLng = shape[i + 1].lng;
      var dx = bLng - aLng, dy = bLat - aLat;
      var segLenSq = dx * dx + dy * dy;
      var t;
      if (segLenSq === 0) { t = 0; }
      else { t = ((lng - aLng) * dx + (lat - aLat) * dy) / segLenSq; if (t < 0) t = 0; if (t > 1) t = 1; }
      var projLat = aLat + t * dy, projLng = aLng + t * dx;
      var d = haversine(lat, lng, projLat, projLng);
      if (d < bestDist) { bestDist = d; bestCum = cumDist[i] + t * (cumDist[i + 1] - cumDist[i]); bestSeg = i; }
    }
    return { distance: bestCum, snapDist: bestDist, seg: bestSeg };
  }
  
  function buildCumDist(shape) {
    var cum = [0];
    for (var i = 1; i < shape.length; i++) cum.push(cum[i - 1] + haversine(shape[i - 1].lat, shape[i - 1].lng, shape[i].lat, shape[i].lng));
    return cum;
  }

  // ---- FIXED getStopsForRoute ----
  function getStopsForRoute(routeId, staticData, stopId) {
    if (!routeId || !staticData) return [];
    var stopMap = {}, orderMap = {};
    var targetTrip = null;
    for (var tid in staticData.trips) {
      if (staticData.trips[tid].route_id !== routeId) continue;
      if (!staticData.trips[tid].stop_times || staticData.trips[tid].stop_times.length === 0) continue;
      if (!targetTrip) targetTrip = staticData.trips[tid];
      if (stopId) {
        for (var j = 0; j < staticData.trips[tid].stop_times.length; j++) {
          if (staticData.trips[tid].stop_times[j].stop_id === stopId) { targetTrip = staticData.trips[tid]; break; }
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
      var s = staticData.stops[sid];
      result.push({ stop_id: sid, name: s ? s.name : sid, order: orderMap[sid] !== undefined ? orderMap[sid] : 9999 });
    }
    result.sort(function(a, b) { return a.order - b.order; });
    return result;
  }

  // ---- FIXED getStopDistanceOnShape (no duplicate skip) ----
  var _stopDistCache = {};
  function getStopDistanceOnShape(routeId, stopId, shape, cumDist, staticData) {
    var fp = '';
    for (var fi = 0; fi < Math.min(10, shape.length); fi++) fp += shape[fi].lat.toFixed(4) + shape[fi].lng.toFixed(4);
    var key = routeId + '|' + fp;
    if (_stopDistCache[key] && _stopDistCache[key][stopId] !== undefined) return _stopDistCache[key][stopId];

    var targetTrip = null;
    for (var tid in staticData.trips) {
      var trip = staticData.trips[tid];
      if (trip.route_id !== routeId) continue;
      if (!trip.shape_id) continue;
      if (!trip.stop_times || trip.stop_times.length === 0) continue;
      if (staticData.shapes[trip.shape_id] !== shape) continue;
      for (var sj = 0; sj < trip.stop_times.length; sj++) {
        if (trip.stop_times[sj].stop_id === stopId) { targetTrip = trip; break; }
      }
      if (targetTrip) break;
    }
    if (!targetTrip) return null;

    var stopDists = {}, prevSeg = 0;
    for (var si = 0; si < targetTrip.stop_times.length; si++) {
      var st = targetTrip.stop_times[si];
      var sid = st.stop_id;
      if (!sid) continue;  // ← FIX: no dup skip, last occurrence wins
      var s = staticData.stops[sid];
      if (!s) continue;
      var snap = closestOnShape(s.lat, s.lon, shape, cumDist, prevSeg);
      stopDists[sid] = snap.distance;
      prevSeg = snap.seg;
    }
    _stopDistCache[key] = stopDists;
    return stopDists[stopId];
  }

  // ---- FIXED getRouteShape ----
  function getRouteShape(routeId, staticData, stopId) {
    if (!staticData || !staticData.shapes || !staticData.trips) return null;
    var anyShape = null;
    for (var tid in staticData.trips) {
      if (staticData.trips[tid].route_id !== routeId) continue;
      if (!staticData.trips[tid].shape_id) continue;
      var s = staticData.shapes[staticData.trips[tid].shape_id];
      if (!s || s.length < 2) continue;
      if (!anyShape) anyShape = s;
      if (stopId) {
        var times = staticData.trips[tid].stop_times;
        if (times) {
          for (var j = 0; j < times.length; j++) {
            if (times[j].stop_id === stopId) return s;
          }
        }
      }
    }
    return anyShape;
  }

  // ==========================================
  // TEST T601 — stop ordering
  // ==========================================
  console.log('=== T601 STOP ORDERING (FIXED) ===');
  var t601Dir0 = getStopsForRoute('T6010', staticData, '1002924');
  var t601Dir1 = getStopsForRoute('T6010', staticData, '1006576');
  var t601Default = getStopsForRoute('T6010', staticData);
  console.log('Dir 0 (stop 1002924): ' + t601Dir0.length + ' stops → ' + t601Dir0.map(function(s){return s.name;}).join(', '));
  console.log('');
  console.log('Dir 1 (stop 1006576): ' + t601Dir1.length + ' stops → ' + t601Dir1.map(function(s){return s.name;}).join(', '));
  console.log('');
  console.log('Default (no stopId):  ' + t601Default.length + ' stops → ' + t601Default.map(function(s){return s.name;}).join(', '));

  // Verify: dir0 and dir1 must be different (different directions have different stop sets)
  var dir0Stops = t601Dir0.map(function(s){return s.stop_id;}).sort().join(',');
  var dir1Stops = t601Dir1.map(function(s){return s.stop_id;}).sort().join(',');
  console.log('');
  if (dir0Stops !== dir1Stops) {
    console.log('✓ Dir 0 and Dir 1 have DIFFERENT stop sets (correct for bidirectional route)');
  } else {
    console.log('✗ ERROR: Dir 0 and Dir 1 have SAME stop sets');
  }
  if (t601Dir0.length <= 25 && t601Dir1.length <= 25) {
    console.log('✓ Both directions have ≤ 25 stops (no merge corruption)');
  } else {
    console.log('✗ ERROR: Stop counts too high (merge still happening?)');
  }

  // ==========================================
  // TEST T541 — ETA on loop with duplicate stop
  // ==========================================
  console.log('');
  console.log('=== T541 LOOP ETA (FIXED) ===');
  
  var shape541 = shapes['U541002'];
  var cum541 = buildCumDist(shape541);
  
  // Find the duplicate stop (first and last)  
  var trip541 = null;
  for (var tid in trips) { if (trips[tid].route_id === 'U5410') { trip541 = trips[tid]; break; } }
  
  var firstSid = trip541.stop_times[0].stop_id;
  var lastSid = trip541.stop_times[trip541.stop_times.length-1].stop_id;
  console.log('First stop: ' + firstSid + ' (' + (stops[firstSid]?stops[firstSid].name:'?') + ')');
  console.log('Last stop:  ' + lastSid + ' (' + (stops[lastSid]?stops[lastSid].name:'?') + ')');
  
  if (firstSid === lastSid) {
    console.log('✓ Same stop at both ends (loop route)');
  }
  
  // Get stop distance for the loop stop
  var shape541a = getRouteShape('U5410', staticData, firstSid);
  var cum541a = buildCumDist(shape541a);
  var stopDist = getStopDistanceOnShape('U5410', firstSid, shape541a, cum541a, staticData);
  console.log('Stop distance on shape: ' + stopDist.toFixed(3) + ' km of ' + cum541a[cum541a.length-1].toFixed(2) + ' km total');
  
  // Old bug: was 0.036 (first occurrence). Fix: should be ~28.820 (last occurrence)
  if (stopDist > 28) {
    console.log('✓ Stop distance is LAST occurrence (~28.8 km) — correct for loop ETA');
  } else {
    console.log('✗ ERROR: Stop distance is FIRST occurrence (' + stopDist.toFixed(3) + ' km) — will break ETA');
  }
  
  // Simulate a bus at km 28 (near end of loop, approaching the stop)
  var busAtEndLat = shape541a[shape541a.length - 20].lat;
  var busAtEndLng = shape541a[shape541a.length - 20].lng;
  var busSnap = closestOnShape(busAtEndLat, busAtEndLng, shape541a, cum541a);
  console.log('Bus at shape[-20] distance: ' + busSnap.distance.toFixed(3) + ' km');
  console.log('Bus past stop (>= ' + stopDist.toFixed(3) + ')? ' + (busSnap.distance >= stopDist ? 'YES (filtered - BAD)' : 'NO (approaching - GOOD)'));
  console.log('Remaining distance: ' + (stopDist - busSnap.distance).toFixed(3) + ' km');
});
