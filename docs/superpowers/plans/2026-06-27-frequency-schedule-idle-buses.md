# Frequency-Based Schedule for Idle Buses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop showing idle terminal buses as "Live" with phantom arrival times. Instead, use GTFS frequencies.txt data to calculate the actual scheduled next departure, and only switch to live GPS ETA when the bus starts moving.

**Architecture:** Parse `frequencies.txt` in the build script, include it in `static.json.gz`, expand it client-side in `gtfs-static.js`, then use it in `scheduler.js` to compute the next departure from a terminal when only idle buses are present. Idle bus ETA = (time until next frequency departure) + (travel time from terminal to selected stop). Displayed as "Scheduled", not "Live".

**Tech Stack:** Node.js build script, vanilla JS client, existing Leaflet/Socket.io/pako stack

## Global Constraints

- Must work with or without `frequencies.txt` in the GTFS zip (graceful degradation)
- Idle bus = speed ≤ 3 km/h AND within 500m of route's first stop
- Moving bus = speed > 3 km/h OR not at terminal → existing live GPS ETA
- When only idle buses exist → "Scheduled" badge, frequency-based time
- When no frequencies data but idle buses → fall through to existing `getScheduleETA` (stop_times)
- Zero user-facing regressions: moving buses, route filtering, favorites behavior unchanged

---

## File Structure

| File | Role |
|------|------|
| `scripts/build-static.js` | Node build: add `frequencies.txt` parsing, merge into output JSON |
| `js/gtfs-static.js` | Client: expand short-key `F` → full `frequencies` objects |
| `js/scheduler.js` | Core: new `getFrequencyDeparture()`, modify `getLiveETA()` idle fallback, wire into `getNextStop()` |
| `tests/run-tests.js` | Add tests for frequency departure calc + idle bus behavior |

---

### Task 1: Parse frequencies.txt in build-static.js

**Files:**
- Modify: `scripts/build-static.js:28-44` (downloadAndProcess)
- Modify: `scripts/build-static.js:51-115` (merge function)

**Interfaces:**
- Consumes: Existing GTFS zip from api.data.gov.my
- Produces: `data.F` — pre-indexed map of `route_id → [{s: start_seconds, e: end_seconds, h: headway_secs, x: exact_times_flag}]` in merged output JSON

- [ ] **Step 1: Add frequencies.txt to the download promises**

In `downloadAndProcess`, add `parseCSV(zip, 'frequencies.txt')` as the 6th promise in the array:

```js
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
```

- [ ] **Step 2: Process frequencies in the merge function**

In `merge()`, add a `frequencies` array. Inside the `all.forEach(...)` loop, add processing for `r.frequencies`:

```js
  var frequencies = []; // add near top of merge(), after var shapes = {};

  all.forEach(function(r) {
    // ... existing processing ...

    r.frequencies.forEach(function(f) {
      if (!f.trip_id) return;
      frequencies.push({
        t: f.trip_id,
        s: timeToSeconds(f.start_time),
        e: timeToSeconds(f.end_time),
        h: parseInt(f.headway_secs) || 0,
        x: parseInt(f.exact_times) || 0
      });
    });
  });
```

- [ ] **Step 3: Build route→frequencies index and add to return object**

```js
  // Build a route→frequencies index for fast client lookup
  var freqByRoute = {};
  for (var fi = 0; fi < frequencies.length; fi++) {
    var fr = frequencies[fi];
    if (!freqByRoute[fr.r]) freqByRoute[fr.r] = [];
    freqByRoute[fr.r].push({ s: fr.s, e: fr.e, h: fr.h, x: fr.x });
  }

  console.log('Merged: ' + Object.keys(routes).length + ' routes, ' + Object.keys(stops).length + ' stops, ' + Object.keys(trips).length + ' trips, ' + Object.keys(shapes).length + ' shapes, ' + frequencies.length + ' frequencies, ' + Object.keys(freqByRoute).length + ' routes with frequencies');
  return { R: routes, S: stops, T: trips, H: shapes, F: freqByRoute, I: nameIndex };
```

- [ ] **Step 4: Verify build works with existing data**

Run: `node scripts/build-static.js`
Expected: Completes without errors, log shows "frequencies: N" (N may be 0 if no frequencies.txt in source)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-static.js
git commit -m "feat: parse frequencies.txt in build-static.js"
```

---

### Task 2: Expand frequencies in gtfs-static.js

**Files:**
- Modify: `js/gtfs-static.js:28-68` (loadStaticData expansion section)

**Interfaces:**
- Consumes: `data.F` — `{ route_id: [{s: start_seconds, e: end_seconds, h: headway_secs, x: exact_times}] }`
- Produces: `expanded.frequencies` — same map structure with expanded key names: `{ route_id: [{start_seconds, end_seconds, headway_secs, exact_times}] }`

- [ ] **Step 1: Add frequencies expansion after shapes expansion**

After the shapes expansion loop, add:

```js
      var frequencies = {};
      if (data.F) {
        for (var rid in data.F) {
          frequencies[rid] = data.F[rid].map(function(f) {
            return {
              start_seconds: f.s,
              end_seconds: f.e,
              headway_secs: f.h,
              exact_times: f.x
            };
          });
        }
      }
```

- [ ] **Step 2: Include frequencies in the expanded object**

```js
      var expanded = { routes: routes, stops: stops, trips: trips, shapes: shapes, frequencies: frequencies, _nameIndex: data.I };
```

- [ ] **Step 3: Verify manually in browser console**

Load the app and in browser console run:
```js
var f = RapidKL.state.static && RapidKL.state.static.frequencies;
console.log(f ? Object.keys(f).length + ' routes have frequencies' : 'not loaded');
```
Expected: Shows count > 0

- [ ] **Step 4: Commit**

```bash
git add js/gtfs-static.js
git commit -m "feat: expand frequencies data in gtfs-static.js"
```

---

### Task 3: Add frequency-based departure calculator to scheduler.js

**Files:**
- Modify: `js/scheduler.js` (add new function near existing schedule helpers)

**Interfaces:**
- Produces: `getFrequencyDeparture(routeId, staticData) → {departureSeconds: number} | null`
  - `departureSeconds`: seconds since midnight when the bus should next depart from the terminal

- [ ] **Step 1: Write the failing test in run-tests.js**

Add this test block after the existing Live ETA tests, before the Summary section:

```js
// ─── Frequency departure calculation ───

console.log('=== getFrequencyDeparture ===\n');

var fd = global.RapidKL;

var sdFreq = {
  trips: {
    't1': { route_id: 'R1', shape_id: 's1', stop_times: [
      { stop_id: 'A', arrival_seconds: 0, sequence: 1 },
      { stop_id: 'B', arrival_seconds: 300, sequence: 2 }
    ]}
  },
  frequencies: {
    'R1': [{ start_seconds: 21600, end_seconds: 36000, headway_secs: 900, exact_times: 0 }]
  },
  shapes: { 's1': [{lat:3, lng:101}, {lat:3.01, lng:101}] },
  stops: {
    'A': { name: 'Terminal', lat: 3.0, lon: 101.0 },
    'B': { name: 'Mid', lat: 3.005, lon: 101.0 }
  },
  routes: { 'R1': { route_id: 'R1', short_name: 'R1' } },
  _nameIndex: { 'R1': 'R1' }
};

// Mock current time to 7:00 AM (25200 seconds)
var origGetCurrent = fd._getCurrentSeconds || (function() {
  var now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
});

// Temporarily override getCurrentSeconds for deterministic test
var mockNow = 25200; // 7:00 AM
var savedGetCurrent = getCurrentSeconds;
getCurrentSeconds = function() { return mockNow; };

// frequencies for R1: t1 from 6:00 (21600) to 10:00 (36000), headway 900s
// At 7:00:01 (25201), next departure: ceil((25201-21600)/900)=ceil(4.001)=5 → 21600+5*900=26100
mockNow = 25201;
var dep1 = fd.getFrequencyDeparture('R1', sdFreq);
assert(dep1 !== null, 'returns departure when frequencies exist');
if (dep1) {
  assert(dep1.departureSeconds === 26100, 'next departure at 7:15 AM (26100) when now=7:00:01');
}

// Unknown route
var dep2 = fd.getFrequencyDeparture('ZZZ', sdFreq);
assert(dep2 === null, 'null for route with no frequencies');

// Route with no frequencies data
var sdNoFreq = { routes: { 'R2': {} }, frequencies: {} };
var dep3 = fd.getFrequencyDeparture('R2', sdNoFreq);
assert(dep3 === null, 'null when frequencies map has no key for route');

getCurrentSeconds = savedGetCurrent;

console.log('  (' + passed + ' passed)\n');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/run-tests.js`
Expected: FAILs with "fd.getFrequencyDeparture is not a function"

- [ ] **Step 3: Implement getFrequencyDeparture in scheduler.js**

Add this function after `getScheduleETA` and before `getNextStop`:

```js
  /**
   * Find the next scheduled departure time for a route using GTFS frequencies.
   * Returns the next departure in seconds-since-midnight.
   * @param {string} routeId
   * @param {AppState['static']} staticData
   * @returns {{ departureSeconds: number } | null}
   */
  function getFrequencyDeparture(routeId, staticData) {
    if (!staticData || !staticData.frequencies || !staticData.frequencies[routeId]) return null;

    var nowSeconds = getCurrentSeconds();
    var entries = staticData.frequencies[routeId];
    var best = null;

    for (var i = 0; i < entries.length; i++) {
      var f = entries[i];

      // Check today's window and tomorrow's window
      var windows = [
        { s: f.start_seconds, e: f.end_seconds },
        { s: f.start_seconds + 86400, e: f.end_seconds + 86400 }
      ];

      for (var w = 0; w < windows.length; w++) {
        var ws = windows[w].s;
        var we = windows[w].e;
        if (ws > we) continue;

        // Find first departure >= nowSeconds within this window
        // departure = start + k * headway, smallest k where departure >= nowSeconds
        var k = Math.ceil((nowSeconds - ws) / f.headway_secs);
        if (k < 0) k = 0;
        var departure = ws + k * f.headway_secs;

        if (departure >= nowSeconds && departure <= we) {
          if (best === null || departure < best) {
            best = departure;
          }
        }
      }
    }

    if (best === null) return null;
    return { departureSeconds: best };
  }
```

- [ ] **Step 4: Expose getFrequencyDeparture on window.RapidKL**

At the bottom of scheduler.js, add to the exports:

```js
  window.RapidKL.getFrequencyDeparture = getFrequencyDeparture;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tests/run-tests.js`
Expected: All tests pass (previous 21 + 3 new assertions = some new count)

- [ ] **Step 6: Commit**

```bash
git add js/scheduler.js tests/run-tests.js
git commit -m "feat: add getFrequencyDeparture for frequency-based schedule"
```

---

### Task 4: Stop idle bus fallback in getLiveETA, wire frequency schedule into getNextStop

**Files:**
- Modify: `js/scheduler.js` (getLiveETA: remove idle fallback, ~line 309; getNextStop: add idle+frequency path, ~line 370)

**Interfaces:**
- Modifies: `getLiveETA()` — no longer returns idle bus fallback; returns null when only idle buses exist
- Modifies: `getNextStop()` — after live ETA returns null, checks for idle buses + frequencies before falling to pure schedule
- Produces: `getNextStop` result — `isProjected: true` for frequency-based idle bus ETA, `isProjected: false` only for GPS-moving buses

- [ ] **Step 1: Remove idle bus fallback from getLiveETA**

Find the line `if (!best) best = bestIdle;` and replace with:

```js
    // Only return live ETA for moving buses. Idle buses at terminal
    // are handled by getFrequencyDeparture in getNextStop.
    if (!best) return null;
```

- [ ] **Step 2: Look up remaining km from terminal to selected stop in getLiveETA**

We need to preserve the distance from terminal to the selected stop so `getNextStop` can compute travel time. Add a variable before the return:

At the top of `getLiveETA`, after computing `stopDist`, add:

```js
    // Terminal-to-stop travel distance (used by idle bus fallback in getNextStop)
    var _terminalToStopKm = stopDist > 0 ? (stopDist * 1.2) : 1;
```

And store it on the returned object (for moving buses) or expose it differently. Actually, simpler: compute it in `getNextStop` itself using the shape. Let me rethink.

The travel time from terminal to selected stop is: `(stopDist * 1.2) / defaultSpeed * 3600` seconds. We need `stopDist` which is already computed in `getLiveETA`. Instead of threading it through, we can recompute it in `getNextStop` when needed — but that's wasteful.

Better approach: store `stopDist` on a side-channel. Add to `getLiveETA`, right after computing `stopDist`, before the if-null guard:

No, even simpler: compute the travel time in `getNextStop` using the same helpers. Let me just pass the shape distance through. Actually, the cleanest approach is:

In `getNextStop`, when we detect idle buses and want to use frequency data:
1. Call `getFrequencyDeparture(routeId, staticData)` to get next departure time
2. Compute remaining seconds = (departureSeconds - nowSeconds) + travelTimeToStop
3. The travel time to stop needs the shape → call `getRouteShape` and `getStopDistanceOnShape`

This avoids threading data through getLiveETA. Just recalculate. The shape/stop distance caching makes it cheap.

So the plan is: `getNextStop` handles the idle bus case with its own shape distance calculation. No changes needed to getLiveETA's return signature beyond removing the idle fallback.

- [ ] **Step 3: Write failing tests for the new getNextStop behavior**

After the frequency departure test block in `run-tests.js`, add:

```js
// ─── getNextStop: idle bus uses frequency schedule, not live ───

console.log('=== getNextStop: idle bus → frequency schedule ===\n');

var sd5 = {
  trips: {
    't1': {
      route_id: 'R1',
      shape_id: 'shape1',
      stop_times: [
        { stop_id: 'A', arrival_seconds: 0, departure_seconds: 0, sequence: 1 },
        { stop_id: 'B', arrival_seconds: 300, departure_seconds: 300, sequence: 2 },
        { stop_id: 'C', arrival_seconds: 600, departure_seconds: 600, sequence: 3 }
      ]
    }
  },
  shapes: {
    'shape1': [
      { lat: 3.0000, lng: 101.0000 },
      { lat: 3.0050, lng: 101.0000 },
      { lat: 3.0100, lng: 101.0000 },
      { lat: 3.0150, lng: 101.0000 },
      { lat: 3.0200, lng: 101.0000 }
    ]
  },
  frequencies: {
    'R1': [{ start_seconds: 21600, end_seconds: 36000, headway_secs: 900, exact_times: 0 }]
  },
  stops: {
    'A': { name: 'Terminal', lat: 3.0000, lon: 101.0000 },
    'B': { name: 'Midpoint', lat: 3.0100, lon: 101.0000 },
    'C': { name: 'End', lat: 3.0200, lon: 101.0000 }
  },
  routes: { 'R1': { route_id: 'R1', short_name: 'R1' } },
  _nameIndex: { 'R1': 'R1' }
};
// Clear caches
delete sd5._shapeCache;
delete sd5._stopDistCache;
delete sd5._allStopDistCache;

// Scenario: idle bus at terminal + frequencies → scheduled ETA
mockNow = 25201; // 7:00:01 AM
getCurrentSeconds = function() { return mockNow; };

var vehiclesIdle = [
  { route_id: 'R1', lat: 3.0001, lng: 101.0000, speed: 0, vehicle_label: 'IDLE_BUS' }
];

var rIdle = fd.getNextStop('R1', 'C', vehiclesIdle, sd5);
assert(rIdle !== null, 'returns result for idle bus with frequencies');
if (rIdle) {
  assert(rIdle.isProjected === true, 'idle bus → marked as projected/scheduled');
  // Next departure = 26100 (7:15), travel time to stop C ≈ shape distance * 1.2 / 25 km/h
  // Shape length ~ 0.02° ≈ 2.2 km, so travel ≈ 2.2 * 1.2 / 25 * 3600 ≈ 380s
  // ETA ≈ (26100 - 25201) + 380 ≈ 1279s from now. arrivalSeconds ≈ 25201 + 1279 = 26480
  // We just verify it's in the ballpark
  var nowS = getCurrentSeconds();
  assert(rIdle.arrivalSeconds > nowS, 'arrival is in the future');
}

// Scenario: moving bus → still live ETA (no regression)
var vehiclesMoving = [
  { route_id: 'R1', lat: 3.0090, lng: 101.0000, speed: 30, vehicle_label: 'MOVING' }
];

var rMoving = fd.getNextStop('R1', 'C', vehiclesMoving, sd5);
assert(rMoving !== null, 'returns result for moving bus');
if (rMoving) {
  assert(rMoving.isProjected === false, 'moving bus → live ETA (not projected)');
  assert(rMoving.vehicleLabel === 'MOVING', 'correct vehicle label');
}

getCurrentSeconds = savedGetCurrent;

console.log('  (' + passed + ' passed)\n');
```

- [ ] **Step 4: Run tests to verify new tests fail**

Run: `node tests/run-tests.js`
Expected: FAIL on "idle bus → marked as projected/scheduled" (still returns live ETA from idle fallback)

- [ ] **Step 5: Rewrite getNextStop to handle idle buses with frequencies**

Replace the `getNextStop` function with the updated version:

```js
  function getNextStop(selectedRouteId, selectedStopId, vehicles, staticData) {
    if (!staticData || !staticData.trips) return null;
    if (!selectedRouteId) return null;

    // Count buses on this route
    var routeBusCount = 0;
    if (vehicles && vehicles.length > 0) {
      for (var i = 0; i < vehicles.length; i++) {
        var vr = resolveRouteId(vehicles[i].route_id, staticData);
        if (vr === selectedRouteId) routeBusCount++;
      }
    }

    // TRY LIVE ETA FIRST
    if (selectedStopId) {
      var live = getLiveETA(selectedRouteId, selectedStopId, vehicles, staticData);
      if (live) {
        live.busCount = routeBusCount;
        return live;
      }

      // LIVE ETA FAILED — check for idle buses at terminal
      var hasFrequency = staticData.frequencies && staticData.frequencies[selectedRouteId];
      if (hasFrequency && vehicles && vehicles.length > 0) {
        var freqDep = getFrequencyDeparture(selectedRouteId, staticData);
        if (freqDep) {
          // Check if any vehicle on this route is idle at terminal
          var shape = getRouteShape(selectedRouteId, staticData, selectedStopId);
          if (shape) {
            var cumDist = buildCumDist(shape);
            var stopDist = getStopDistanceOnShape(selectedRouteId, selectedStopId, shape, cumDist, staticData);
            if (stopDist !== null && stopDist !== undefined) {
              // Find first stop's distance for terminal detection
              var stops = getStopsForRoute(selectedRouteId, staticData, selectedStopId);
              var firstStopDist = 0;
              if (stops.length > 0) {
                var fsd = getStopDistanceOnShape(selectedRouteId, stops[0].stop_id, shape, cumDist, staticData);
                if (fsd !== null && fsd !== undefined) firstStopDist = fsd;
              }

              var hasIdle = false;
              for (var i = 0; i < vehicles.length; i++) {
                var v = vehicles[i];
                if (v.route_id !== selectedRouteId) continue;
                var bs = closestOnShape(v.lat, v.lng, shape, cumDist);
                if (bs.snapDist <= 0.3 && v.speed <= 3 && Math.abs(bs.distance - firstStopDist) < 0.5) {
                  hasIdle = true;
                  break;
                }
              }

              if (hasIdle) {
                // Idle bus at terminal + frequencies → frequency-based schedule ETA
                var nowSec = getCurrentSeconds();
                var waitSeconds = freqDep.departureSeconds - nowSec;
                if (waitSeconds < 0) waitSeconds = 0;
                // Travel time from terminal (start of shape, distance 0) to stop
                var travelKm = stopDist * 1.2;
                var travelSeconds = (travelKm / 25) * 3600;
                var arrivalSec = nowSec + waitSeconds + Math.round(travelSeconds);

                var stop = staticData.stops ? staticData.stops[selectedStopId] : null;
                var display = secondsToDisplay(arrivalSec);
                return {
                  stopName: stop ? stop.name : selectedStopId,
                  time: display.time,
                  period: display.period,
                  arrivalSeconds: arrivalSec,
                  vehicleLabel: '',
                  busCount: routeBusCount,
                  isProjected: true,
                  stopLat: stop ? stop.lat : 0,
                  stopLng: stop ? stop.lon : 0
                };
              }
            }
          }
        }
      }

      // Fall back to schedule
      var sched = getScheduleETA(selectedRouteId, selectedStopId, staticData);
      if (sched) {
        sched.busCount = routeBusCount;
        return sched;
      }

      var stop = staticData.stops ? staticData.stops[selectedStopId] : null;
      return {
        stopName: stop ? stop.name : 'Stop',
        time: '--:--', period: '',
        arrivalSeconds: 0, vehicleLabel: '',
        busCount: routeBusCount, isProjected: true
      };
    }

    // No stop selected — soonest stop across all trips
    if (!selectedStopId) {
      var nowSeconds = getCurrentSeconds();
      var lookahead = 26 * 3600;
      var best = null;

      for (var tid in staticData.trips) {
        var trip = staticData.trips[tid];
        if (trip.route_id !== selectedRouteId) continue;
        if (!trip.stop_times || trip.stop_times.length === 0) continue;

        for (var j = 0; j < trip.stop_times.length; j++) {
          var st = trip.stop_times[j];
          var arrival = st.arrival_seconds;
          if (arrival >= 86400) arrival = arrival % 86400;
          if (arrival < nowSeconds) arrival += 86400;

          if (arrival > nowSeconds && arrival < nowSeconds + lookahead) {
            if (!best || arrival < best.arrival_seconds) {
              var stopInfo = staticData.stops ? staticData.stops[st.stop_id] : null;
              best = {
                stopName: stopInfo ? stopInfo.name : (st.stop_id || 'Unknown'),
                arrival_seconds: arrival,
                busCount: routeBusCount,
                isProjected: true
              };
            }
            break;
          }
        }
      }

      if (best) {
        var display = secondsToDisplay(best.arrival_seconds);
        best.time = display.time;
        best.period = display.period;
        return best;
      }

      return {
        stopName: 'No upcoming stops',
        time: '--:--', period: '',
        arrivalSeconds: 0, vehicleLabel: '',
        busCount: routeBusCount, isProjected: true
      };
    }

    return null;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node tests/run-tests.js`
Expected: All tests pass (previous count + 6 new assertions)

- [ ] **Step 7: Commit**

```bash
git add js/scheduler.js tests/run-tests.js
git commit -m "fix: use frequency schedule for idle buses, not fake live ETA"
```

---

### Task 5: Rebuild static data and end-to-end smoke test

**Files:**
- No code changes — verification only

- [ ] **Step 1: Rebuild static data**

```bash
node scripts/build-static.js
```
Expected: Completes, log shows frequencies count

- [ ] **Step 2: Run full test suite**

```bash
node tests/run-tests.js
```
Expected: All tests pass, zero failures

- [ ] **Step 3: Start local server and smoke test**

```bash
npx serve . -l 3000
```

Open browser to localhost:3000. Verify:
- Routes populate in dropdown
- Selecting a route shows buses and stops
- Status dots turn green (static ok, live ok, match ok)
- ETA displays for selected stops
- Quick dial favorites still work

- [ ] **Step 4: Commit any final changes and push**

```bash
git status
# If data/static.json.gz changed (rebuilt with frequencies):
git add data/static.json.gz
git commit -m "chore: rebuild static data with frequencies"
git push origin main
```

---

## Task Ordering

Tasks are sequential:
1. **Task 1** — Build script changes (no client impact)
2. **Task 2** — Client data expansion (feature hidden, no user impact)
3. **Task 3** — Frequency departure calculator with tests (still not wired)
4. **Task 4** — Wire into getNextStop + remove idle fallback + tests (user-visible fix)
5. **Task 5** — Rebuild, full test, smoke test, push

Each task produces a commit that could be deployed independently without breaking anything — the feature only activates in Task 4.
