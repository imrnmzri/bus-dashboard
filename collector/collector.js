/**
 * Bus dashboard departure collector.
 * Connects to Prasarana's Socket.IO AVL feed 24/7,
 * detects when buses depart terminals, and commits
 * observed departure timestamps to the GitHub repo daily.
 *
 * Deployed on Render.com free tier.
 * Required env vars on Render:
 *   GITHUB_TOKEN — classic PAT with repo scope
 *   REPO         — e.g. "imrnmzri/bus-dashboard"
 */

var io = require('socket.io-client');
var pako = require('pako');
var zlib = require('zlib');
var fs = require('fs');
var https = require('https');

// ─── Constants ───

var SID = 'o283cdurm0f0sih1s9henff3jl4g';
var SOCKET_URL = 'https://rapidbus-socketio-avl.prasarana.com.my';
var PROVIDER = 'RKL';
var RELOAD_MS = 5000;

var GITHUB_TOKEN = process.env.GITHUB_TOKEN;
var REPO = process.env.REPO || 'imrnmzri/bus-dashboard';
var HEADWAYS_PATH = 'data/headways.json';

// MYT = UTC+8. Operating hours: 6AM–12AM MYT = 22:00–16:00 UTC
function isOperatingHours() {
  var h = new Date().getUTCHours();
  return h >= 22 || h < 16;
}

// ─── Load static data ───

var staticData = null;

function loadStaticData() {
  var buf = fs.readFileSync('../data/static.json.gz');
  var raw = zlib.gunzipSync(buf).toString('utf8');
  var compact = JSON.parse(raw);
  staticData = compact;
  console.log('[static] loaded: ' + Object.keys(compact.R).length + ' routes, ' +
    Object.keys(compact.S).length + ' stops, ' +
    Object.keys(compact.T).length + ' trips');
}

// ─── Resolve route_id from live feed ───

var nameIndex = {};

function buildNameIndex() {
  for (var rid in staticData.R) {
    nameIndex[rid] = rid;
    var r = staticData.R[rid];
    if (r.sn) { nameIndex[r.sn] = rid; nameIndex[r.sn.toUpperCase()] = rid; }
    if (r.ln) { nameIndex[r.ln] = rid; nameIndex[r.ln.toUpperCase()] = rid; }
  }
}

function resolveRouteId(liveRouteId) {
  if (!liveRouteId) return null;
  if (staticData.R[liveRouteId]) return liveRouteId;
  var resolved = nameIndex[liveRouteId];
  if (resolved) return resolved;
  // Strip trailing digit
  if (liveRouteId.length > 1 && /[0-9]$/.test(liveRouteId)) {
    var stripped = liveRouteId.slice(0, -1);
    if (staticData.R[stripped]) return stripped;
    if (nameIndex[stripped]) return nameIndex[stripped];
  }
  return null;
}

// ─── Shape / stop helpers ───

function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildCumDist(shape) {
  var cum = [0];
  for (var i = 1; i < shape.length; i++) {
    cum.push(cum[i - 1] + haversine(shape[i - 1].lat, shape[i - 1].lng, shape[i].lat, shape[i].lng));
  }
  return cum;
}

function closestOnShape(lat, lng, shape, cumDist) {
  var bestDist = Infinity, bestCum = 0;
  for (var i = 0; i < shape.length - 1; i++) {
    var aLat = shape[i].lat, aLng = shape[i].lng;
    var bLat = shape[i + 1].lat, bLng = shape[i + 1].lng;
    var dx = bLng - aLng, dy = bLat - aLat;
    var segLenSq = dx * dx + dy * dy;
    var t = segLenSq === 0 ? 0 : Math.max(0, Math.min(1,
      ((lng - aLng) * dx + (lat - aLat) * dy) / segLenSq));
    var projLat = aLat + t * dy, projLng = aLng + t * dx;
    var d = haversine(lat, lng, projLat, projLng);
    if (d < bestDist) { bestDist = d; bestCum = cumDist[i] + t * (cumDist[i + 1] - cumDist[i]); }
  }
  return { distance: bestCum, snapDist: bestDist };
}

// ─── Route-info cache: first stop + shape per (route_id, direction_id) ───

var routeInfoCache = {};

function getRouteInfo(routeId, directionId) {
  var key = routeId + '_' + directionId;
  if (routeInfoCache[key]) return routeInfoCache[key];

  for (var tid in staticData.T) {
    var t = staticData.T[tid];
    if (t.r !== routeId) continue;
    if (t.d !== directionId) continue;
    if (!t.st || t.st.length === 0) continue;
    if (!t.sh || !staticData.H[t.sh]) continue;

    var sorted = t.st.slice().sort(function(a, b) { return a.seq - b.seq; });
    var firstStopId = sorted[0].s;
    var firstStop = staticData.S[firstStopId];
    if (!firstStop) continue;

    var shape = staticData.H[t.sh];
    routeInfoCache[key] = {
      firstStopId: firstStopId,
      firstStopLat: firstStop.lat,
      firstStopLng: firstStop.lng,
      shape: shape,
      cumDist: buildCumDist(shape),
      firstStopSnap: closestOnShape(firstStop.lat, firstStop.lng, shape, buildCumDist(shape))
    };
    return routeInfoCache[key];
  }

  routeInfoCache[key] = null;
  return null;
}

// ─── Departure detection ───

var vehicleStates = {};   // bus_no → { state, routeId, directionId, lastSeen }
var departures = {};       // route_dir → { weekday: [epochs], weekend: [epochs] }

function classifyVehicle(v, routeId, directionId) {
  var info = getRouteInfo(routeId, directionId);
  if (!info) return { state: 'UNKNOWN' };

  var snap = closestOnShape(v.lat, v.lng, info.shape, info.cumDist);
  if (snap.snapDist > 1.0) return { state: 'OFF_ROUTE' };  // >1km from shape

  var distFromFirst = Math.abs(snap.distance - info.firstStopSnap.distance);
  var nearTerminal = distFromFirst < 0.2; // 200m

  if (v.speed <= 3 && nearTerminal && distFromFirst < 0.1) {
    return { state: 'IDLE', distFromFirst: distFromFirst };
  }
  if (v.speed > 15 && (distFromFirst > 0.02 || v.speed > 15)) {
    return { state: 'MOVING', distFromFirst: distFromFirst };
  }
  return { state: 'TRANSITION', distFromFirst: distFromFirst };
}

function processVehicle(v) {
  // Skip outside operating hours (6AM–12AM MYT)
  if (!isOperatingHours()) return;

  // Resolve route
  var routeId = resolveRouteId(v.route_id);
  if (!routeId) return;

  // Direction: "01" → 1, "02" → 0
  var directionId = v.dir === '02' ? 0 : 1;

  var info = getRouteInfo(routeId, directionId);
  if (!info) return;

  var classification = classifyVehicle(v, routeId, directionId);
  var key = v.bus_no;

  var prev = vehicleStates[key];
  vehicleStates[key] = {
    state: classification.state,
    routeId: routeId,
    directionId: directionId,
    lastSeen: Date.now()
  };

  // Departure detection: IDLE → not-IDLE
  if (prev && prev.routeId === routeId && prev.directionId === directionId) {
    if (prev.state === 'IDLE' && classification.state !== 'IDLE' && classification.state !== 'OFF_ROUTE') {
      recordDeparture(routeId, directionId);
    }
  }
}

function recordDeparture(routeId, directionId) {
  var now = new Date();
  var dayOfWeek = now.getUTCDay(); // Use UTC for consistency on Render
  var isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
  var type = isWeekend ? 'weekend' : 'weekday';
  var epoch = Math.floor(now.getTime() / 1000);
  var key = routeId + '_' + directionId;

  if (!departures[key]) departures[key] = { weekday: [], weekend: [] };
  departures[key][type].push(epoch);

  // Deduplicate: don't record same vehicle twice within 2 minutes
  departures[key][type] = dedupeArray(departures[key][type], 120);
}

function dedupeArray(arr, minGapSec) {
  if (arr.length < 2) return arr;
  arr.sort(function(a, b) { return a - b; });
  var result = [arr[0]];
  for (var i = 1; i < arr.length; i++) {
    if (arr[i] - result[result.length - 1] >= minGapSec) {
      result.push(arr[i]);
    }
  }
  return result;
}

// ─── Socket.IO connection ───

function decompressAndParse(raw) {
  console.log('[socket] raw type: ' + typeof raw + ', length: ' +
    (typeof raw === 'string' ? raw.length : (raw ? raw.length || Object.keys(raw).length : 'null')));
  var bytes;
  if (typeof raw === 'string') {
    // Browser-style: base64 string → binary string → bytes
    var binary = '';
    try {
      binary = Buffer.from(raw, 'base64').toString('binary');
    } catch (e) {
      // If that fails, try treating as already-decoded
      binary = raw;
    }
    bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else if (Buffer.isBuffer(raw)) {
    bytes = raw;
  } else if (raw instanceof Uint8Array) {
    bytes = raw;
  } else {
    console.error('[socket] unknown raw type, skipping');
    return {};
  }

  var inflated;
  try {
    inflated = pako.inflate(bytes);
  } catch (e) {
    console.error('[socket] pako.inflate failed: ' + e.message + ', bytes length: ' + bytes.length);
    // Try ungzip as fallback
    try {
      inflated = pako.ungzip(bytes);
      console.log('[socket] ungzip succeeded');
    } catch (e2) {
      console.error('[socket] ungzip also failed');
      return {};
    }
  }

  var text = '';
  for (var j = 0; j < inflated.length; j++) text += String.fromCharCode(inflated[j]);

  var data = JSON.parse(text);
  var count = Object.keys(data).length;
  if (count > 0) {
    var firstKey = Object.keys(data)[0];
    var firstBus = data[firstKey];
    console.log('[socket] parsed ' + count + ' vehicles, first: ' +
      (firstBus.bus_no || firstKey) + ' route=' + (firstBus.route || '?') +
      ' lat=' + firstBus.latitude + ' lng=' + firstBus.longitude + ' speed=' + firstBus.speed);
  } else {
    console.log('[socket] parsed 0 vehicles');
  }
  return data;
}

var snapshotCount = 0;
var totalProcessed = 0;
var totalSkippedNoRoute = 0;
var totalSkippedNoFreq = 0;
var totalSkippedNoInfo = 0;

function processVehicleSnapshot(data) {
  snapshotCount++;
  var inCount = Object.keys(data).length;
  var processed = 0;

  for (var key in data) {
    var b = data[key];
    if (!b) continue;
    var lat = parseFloat(b.latitude);
    var lng = parseFloat(b.longitude);
    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) continue;

    processVehicle({
      bus_no: b.bus_no || key,
      route_id: b.route || null,
      dir: b.dir || '',
      lat: lat,
      lng: lng,
      speed: parseInt(b.speed) || 0
    });
    processed++;
  }

  totalProcessed += processed;

  // Log stats every 100 snapshots
  if (snapshotCount % 100 === 1) {
    console.log('[stats] snapshot #' + snapshotCount + ': ' + inCount + ' incoming, ' +
      processed + ' valid, ' + totalProcessed + ' total processed, ' +
      Object.keys(vehicleStates).length + ' vehicles tracked, ' +
      Object.keys(departures).length + ' routes with departures');
  }
}

function connectSocket() {
  console.log('[socket] connecting to ' + SOCKET_URL);
  var socket = io(SOCKET_URL, { transports: ['websocket'] });

  socket.on('connect', function() {
    console.log('[socket] connected');
    socket.emit('onFts-reload', { sid: SID, uid: '', provider: PROVIDER, route: '' });
  });

  socket.on('onFts-client', function(raw) {
    try {
      var data = decompressAndParse(raw);
      processVehicleSnapshot(data);
    } catch (e) {
      console.error('[socket] parse error:', e.message);
    }
  });

  socket.on('connect_error', function(err) {
    console.error('[socket] connect error:', err.message);
  });

  socket.on('error', function(err) {
    console.error('[socket] error:', err);
  });

  socket.on('reconnect_attempt', function() {
    console.log('[socket] reconnect attempt');
  });

  socket.on('disconnect', function(reason) {
    console.log('[socket] disconnected: ' + reason);
    // Socket.io auto-reconnects
  });

  // Keep-alive: re-emit every RELOAD_MS
  setInterval(function() {
    if (socket.connected) {
      socket.emit('onFts-reload', { sid: SID, uid: '', provider: PROVIDER, route: '' });
    }
  }, RELOAD_MS);
}

// ─── Daily GitHub commit ───

var lastCommitDate = '';

function gitHubAPI(method, path, body) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + GITHUB_TOKEN,
        'User-Agent': 'bus-dashboard-collector',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    var req = https.request(options, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString('utf8');
        try {
          var json = JSON.parse(text);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: text });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function commitHeadways() {
  if (!GITHUB_TOKEN) {
    console.error('[commit] GITHUB_TOKEN not set — skipping');
    return;
  }

  var now = new Date();
  var todayStr = now.toISOString().slice(0, 10);

  // Only commit once per UTC day
  if (todayStr === lastCommitDate) return;
  // Only commit after 16:00 UTC (midnight MYT)
  if (now.getUTCHours() < 16) return;

  console.log('[commit] starting daily commit for ' + todayStr);

  // Get existing file to get SHA
  var existing = await gitHubAPI('GET', '/repos/' + REPO + '/contents/' + HEADWAYS_PATH);

  var merged = {};

  if (existing.status === 200) {
    try {
      var decoded = Buffer.from(existing.body.content, 'base64').toString('utf8');
      merged = JSON.parse(decoded);
    } catch (e) {
      console.error('[commit] failed to parse existing headways.json:', e.message);
      merged = {};
    }
  }

  // Roll in-memory departures into merged — rolling 30 days
  var cutoff = Math.floor(Date.now() / 1000) - 30 * 86400;

  for (var key in departures) {
    if (!merged[key]) merged[key] = { weekday: [], weekend: [] };
    for (var type in departures[key]) {
      var combined = (merged[key][type] || []).concat(departures[key][type]);
      // Sort and deduplicate
      combined.sort(function(a, b) { return a - b; });
      merged[key][type] = dedupeArray(combined, 120);
      // Rolling 30 days
      merged[key][type] = merged[key][type].filter(function(ts) { return ts >= cutoff; });
    }
  }

  var content = JSON.stringify(merged, null, 2);
  var encoded = Buffer.from(content).toString('base64');

  var putBody = {
    message: 'update headways [' + todayStr + ']',
    content: encoded,
    branch: 'main',
    author: { name: 'github-actions[bot]', email: 'github-actions[bot]@users.noreply.github.com' },
    committer: { name: 'github-actions[bot]', email: 'github-actions[bot]@users.noreply.github.com' }
  };

  if (existing.status === 200 && existing.body.sha) {
    putBody.sha = existing.body.sha;
  }

  var result = await gitHubAPI('PUT', '/repos/' + REPO + '/contents/' + HEADWAYS_PATH, putBody);

  if (result.status === 200 || result.status === 201) {
    console.log('[commit] success: ' + content.length + ' bytes written');
    lastCommitDate = todayStr;
  } else {
    console.error('[commit] failed: HTTP ' + result.status + ' — ' + JSON.stringify(result.body));
  }
}

// ─── Health endpoint for Render ping ───

function startHealthServer() {
  var http = require('http');
  var server = http.createServer(function(req, res) {
    if (req.url === '/debug') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Show per-route departure counts
      var summary = {};
      for (var key in departures) {
        var counts = {};
        for (var t in departures[key]) {
          counts[t] = departures[key][t].length;
        }
        summary[key] = counts;
      }
      res.end(JSON.stringify({
        routes: summary,
        vehicleStates: Object.keys(vehicleStates).length + ' vehicles tracked',
        snapshots: snapshotCount + ' snapshots received',
        vehiclesProcessed: totalProcessed,
        operating: isOperatingHours(),
        lastCommit: lastCommitDate || 'never'
      }, null, 2));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      operating: isOperatingHours(),
      departures: Object.keys(departures).length + ' routes tracked',
      lastCommit: lastCommitDate || 'never'
    }));
  });
  var port = process.env.PORT || 3000;
  server.listen(port, function() {
    console.log('[health] listening on port ' + port);
  });
}

// ─── Main ───

console.log('[collector] starting bus-dashboard-departure-collector');
loadStaticData();
buildNameIndex();
startHealthServer();
connectSocket();

// Check for commit every 10 minutes
setInterval(commitHeadways, 10 * 60 * 1000);
