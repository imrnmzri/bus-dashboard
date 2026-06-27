(function() {
  'use strict';

  function resolveRouteId(vehicleRouteId, staticData) {
    if (!vehicleRouteId || !staticData || !staticData.routes) return null;
    if (staticData.routes[vehicleRouteId]) return vehicleRouteId;
    var idx = staticData._nameIndex || {};
    if (idx[vehicleRouteId]) return idx[vehicleRouteId];
    return null;
  }

  function secondsToDisplay(totalSeconds) {
    var secs = totalSeconds % 86400;
    var h = Math.floor(secs / 3600);
    var m = Math.floor((secs % 3600) / 60);
    var period = h >= 12 ? 'PM' : 'AM';
    var dh = h % 12;
    if (dh === 0) dh = 12;
    return {
      time: (dh < 10 ? '0' : '') + dh + ':' + (m < 10 ? '0' : '') + m,
      period: period,
      seconds: totalSeconds
    };
  }

  function getCurrentSeconds() {
    var now = new Date();
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  }

  /**
   * Haversine distance in km between two lat/lng points.
   * @param {number} lat1
   * @param {number} lon1
   * @param {number} lat2
   * @param {number} lon2
   * @returns {number} Distance in kilometers
   */
  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Find closest point on a shape polyline, return cumulative distance from start.
  // Optional startSeg constrains the search to shape indices >= startSeg.
  function closestOnShape(lat, lng, shape, cumDist, startSeg) {
    var bestDist = Infinity;
    var bestCum = 0;
    var bestLat = shape[0].lat;
    var bestLng = shape[0].lng;
    var bestSeg = startSeg || 0;

    var s = startSeg || 0;
    for (var i = s; i < shape.length - 1; i++) {
      var aLat = shape[i].lat, aLng = shape[i].lng;
      var bLat = shape[i + 1].lat, bLng = shape[i + 1].lng;

      var dx = bLng - aLng, dy = bLat - aLat;
      var segLenSq = dx * dx + dy * dy;

      var t;
      if (segLenSq === 0) {
        t = 0;
      } else {
        t = ((lng - aLng) * dx + (lat - aLat) * dy) / segLenSq;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
      }

      var projLat = aLat + t * dy;
      var projLng = aLng + t * dx;
      var d = haversine(lat, lng, projLat, projLng);

      if (d < bestDist) {
        bestDist = d;
        bestLat = projLat;
        bestLng = projLng;
        bestCum = cumDist[i] + t * (cumDist[i + 1] - cumDist[i]);
        bestSeg = i;
      }
    }

    return { distance: bestCum, lat: bestLat, lng: bestLng, snapDist: bestDist, seg: bestSeg };
  }

  // Get the cumulative distance of a stop along the shape, using stop-sequence
  // order to constrain the projection (monotonic — stops are projected in order).
  function getStopDistanceOnShape(routeId, stopId, shape, cumDist, staticData) {
    if (!staticData._stopDistCache) staticData._stopDistCache = {};

    var fp = '';
    for (var fi = 0; fi < Math.min(10, shape.length); fi++) {
      fp += shape[fi].lat.toFixed(4) + shape[fi].lng.toFixed(4);
    }
    var key = routeId + '|' + fp;

    if (staticData._stopDistCache[key]) {
      var cached = staticData._stopDistCache[key];
      if (cached[stopId] !== undefined) return cached[stopId];
    }

    // Find a trip for this route whose shape matches and which contains the stop
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

    // Project each stop in sequence order. Constrain search to a window
    // around the expected position based on stop sequence fraction, to
    // avoid jumping to the wrong pass on loop routes.
    var stopDists = {};
    var prevSeg = 0;
    var totalKm = cumDist[cumDist.length - 1];
    var totalStops = targetTrip.stop_times.length;

    for (var si = 0; si < totalStops; si++) {
      var st = targetTrip.stop_times[si];
      var sid = st.stop_id;
      if (!sid) continue;

      var s = staticData.stops[sid];
      if (!s) continue;

      var expectedDist = (si / totalStops) * totalKm;
      var windowHalf = totalKm * 0.2;
      var minDist = Math.max(0, expectedDist - windowHalf);
      var maxDist = Math.min(totalKm, expectedDist + windowHalf);

      var wStart = prevSeg;
      for (var wi = prevSeg; wi < cumDist.length; wi++) {
        if (cumDist[wi] >= minDist) { wStart = wi; break; }
      }

      var wEnd = shape.length - 1;
      for (var wi = wStart; wi < cumDist.length; wi++) {
        if (cumDist[wi] > maxDist) { wEnd = wi - 1; break; }
      }

      var bestDist = Infinity;
      var bestCum = prevSeg > 0 ? cumDist[prevSeg] : 0;
      var bestSeg = wStart;

      for (var i = wStart; i < Math.min(wEnd, shape.length - 1); i++) {
        var aLat = shape[i].lat, aLng = shape[i].lng;
        var bLat = shape[i + 1].lat, bLng = shape[i + 1].lng;

        var dx = bLng - aLng, dy = bLat - aLat;
        var segLenSq = dx * dx + dy * dy;

        var t;
        if (segLenSq === 0) { t = 0; }
        else {
          t = ((s.lon - aLng) * dx + (s.lat - aLat) * dy) / segLenSq;
          if (t < 0) t = 0;
          if (t > 1) t = 1;
        }

        var projLat = aLat + t * dy;
        var projLng = aLng + t * dx;
        var d = haversine(s.lat, s.lon, projLat, projLng);

        if (d < bestDist) {
          bestDist = d;
          bestCum = cumDist[i] + t * (cumDist[i + 1] - cumDist[i]);
          bestSeg = i;
        }
      }

      stopDists[sid] = bestCum;
      prevSeg = bestSeg;
    }

    staticData._stopDistCache[key] = stopDists;
    return stopDists[stopId];
  }

  // Get the shape for a route, preferring a trip that serves the given stop
  function getRouteShape(routeId, staticData, stopId) {
    if (!staticData || !staticData.shapes || !staticData.trips) return null;

    // Cache by (routeId, stopId) since stopId steers to a specific trip's shape
    if (!staticData._shapeCache) staticData._shapeCache = {};
    var cacheKey = routeId + '|' + (stopId || '');
    if (staticData._shapeCache[cacheKey] !== undefined) {
      return staticData._shapeCache[cacheKey];
    }

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
            if (times[j].stop_id === stopId) {
              staticData._shapeCache[cacheKey] = s;
              return s;
            }
          }
        }
      }
    }

    staticData._shapeCache[cacheKey] = anyShape;
    return anyShape;
  }

  // Precalculate cumulative distances for a shape
  function buildCumDist(shape) {
    var cum = [0];
    for (var i = 1; i < shape.length; i++) {
      cum.push(cum[i - 1] + haversine(shape[i - 1].lat, shape[i - 1].lng, shape[i].lat, shape[i].lng));
    }
    return cum;
  }

  // Calculate LIVE ETA based on bus GPS positions
  function getLiveETA(selectedRouteId, selectedStopId, vehicles, staticData) {
    if (!selectedRouteId || !selectedStopId) return null;

    var shape = getRouteShape(selectedRouteId, staticData, selectedStopId);
    if (!shape) return null;

    var cumDist = buildCumDist(shape);
    var stop = staticData.stops ? staticData.stops[selectedStopId] : null;
    if (!stop) return null;

    var stopDist = getStopDistanceOnShape(selectedRouteId, selectedStopId, shape, cumDist, staticData);
    if (stopDist === null || stopDist === undefined) return null;

    // Find the first stop's shape distance to detect terminal-idling buses
    var firstStopDist = 0;
    var stops = getStopsForRoute(selectedRouteId, staticData, selectedStopId);
    if (stops.length > 0) {
      var fsd = getStopDistanceOnShape(selectedRouteId, stops[0].stop_id, shape, cumDist, staticData);
      if (fsd !== null && fsd !== undefined) firstStopDist = fsd;
    }

    function isIdleAtTerminal(busSnap) {
      // Bus within 500m of the first stop and barely moving = idling at terminal/depot
      return Math.abs(busSnap.distance - firstStopDist) < 0.5;
    }

    var best = null;
    var bestIdle = null; // fallback: best idle bus if no moving buses exist

    for (var i = 0; i < vehicles.length; i++) {
      var v = vehicles[i];
      if (v.route_id !== selectedRouteId) continue;

      var busSnap = closestOnShape(v.lat, v.lng, shape, cumDist);

      // Only consider buses approaching the stop (not past it)
      if (busSnap.distance >= stopDist) continue;

      // Bus must be within 300m of the shape to be considered on route
      if (busSnap.snapDist > 0.3) continue;

      var isIdle = v.speed <= 3 && isIdleAtTerminal(busSnap);

      var remainingKm = stopDist - busSnap.distance;
      var speedKmh = v.speed > 3 ? v.speed : 25;

      // Apply a road factor: shape distance * 1.2 to account for deviations
      var etaSeconds = (remainingKm * 1.2 / speedKmh) * 3600;

      var candidate = {
        seconds: etaSeconds,
        vehicleLabel: v.vehicle_label || '',
        remainingKm: remainingKm,
        speedKmh: speedKmh,
        busDistance: busSnap.distance,
        isIdle: isIdle
      };

      if (isIdle) {
        // Track best idle bus as fallback, but don't include in normal best
        if (!bestIdle || etaSeconds < bestIdle.seconds) {
          bestIdle = candidate;
        }
      } else {
        if (!best || etaSeconds < best.seconds) {
          best = candidate;
        }
      }
    }

    // If no moving buses found, fall back to best idle bus (bus waiting at terminal)
    if (!best) best = bestIdle;
    if (!best) return null;

    var nowSec = getCurrentSeconds();
    var arrivalSec = nowSec + Math.round(best.seconds);
    var display = secondsToDisplay(arrivalSec);

    return {
      stopName: stop.name || selectedStopId,
      time: display.time,
      period: display.period,
      arrivalSeconds: arrivalSec,
      vehicleLabel: best.vehicleLabel,
      busCount: 1,
      isProjected: false,
      stopLat: stop.lat,
      stopLng: stop.lon,
      bestBusDistance: best.busDistance
    };
  }

  // Schedule-based fallback
  function getScheduleETA(selectedRouteId, selectedStopId, staticData) {
    if (!selectedRouteId || !selectedStopId) return null;

    var nowSeconds = getCurrentSeconds();
    var lookahead = 26 * 3600;
    var bestArrival = null;

    for (var tid in staticData.trips) {
      var trip = staticData.trips[tid];
      if (trip.route_id !== selectedRouteId) continue;
      if (!trip.stop_times) continue;

      for (var j = 0; j < trip.stop_times.length; j++) {
        var st = trip.stop_times[j];
        if (st.stop_id !== selectedStopId) continue;

        var arrival = st.arrival_seconds;
        // Normalize GTFS times that cross midnight (e.g., 25:30 = 91800 → 5400 = 1:30 AM)
        if (arrival >= 86400) arrival = arrival % 86400;
        // If this time has already passed today, wrap to tomorrow
        if (arrival < nowSeconds) arrival += 86400;

        if (arrival > nowSeconds && arrival < nowSeconds + lookahead) {
          if (!bestArrival || arrival < bestArrival) {
            bestArrival = arrival;
          }
        }
      }
    }

    if (!bestArrival) return null;

    var stop = staticData.stops ? staticData.stops[selectedStopId] : null;
    var display = secondsToDisplay(bestArrival);

    return {
      stopName: stop ? stop.name : selectedStopId,
      time: display.time,
      period: display.period,
      arrivalSeconds: bestArrival,
      vehicleLabel: '',
      busCount: 0,
      isProjected: true,
      stopLat: stop ? stop.lat : 0,
      stopLng: stop ? stop.lon : 0
    };
  }

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
          // Normalize GTFS times that cross midnight
          if (arrival >= 86400) arrival = arrival % 86400;
          // If this time has already passed today, wrap to tomorrow
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
          if (staticData.trips[tid].stop_times[j].stop_id === stopId) {
            targetTrip = staticData.trips[tid];
            break;
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

    var stops = staticData.stops;
    var result = [];
    for (var sid in stopMap) {
      var s = stops[sid];
      result.push({ stop_id: sid, name: s ? s.name : sid, order: orderMap[sid] !== undefined ? orderMap[sid] : 9999 });
    }
    result.sort(function(a, b) { return a.order - b.order; });
    return result;
  }

  function getTimeUntil(nextStop) {
    if (!nextStop || !nextStop.arrivalSeconds) return -1;
    var now = getCurrentSeconds();
    var diff = nextStop.arrivalSeconds - now;
    if (diff < 0) diff += 86400;
    return Math.max(0, Math.round(diff / 60));
  }

  // Return all stop -> shape distance mappings for a route (cached)
  function getAllStopDistances(routeId, staticData, stopId) {
    if (!staticData._allStopDistCache) staticData._allStopDistCache = {};
    var cacheKey = routeId + '|' + (stopId || '');
    if (staticData._allStopDistCache[cacheKey]) return staticData._allStopDistCache[cacheKey];

    var shape = getRouteShape(routeId, staticData, stopId);
    if (!shape) { staticData._allStopDistCache[cacheKey] = {}; return {}; }
    var cumDist = buildCumDist(shape);
    var stops = getStopsForRoute(routeId, staticData, stopId);
    var result = {};
    for (var i = 0; i < stops.length; i++) {
      var sid = stops[i].stop_id;
      var d = getStopDistanceOnShape(routeId, sid, shape, cumDist, staticData);
      if (d !== null && d !== undefined) result[sid] = d;
    }
    staticData._allStopDistCache[cacheKey] = result;
    return result;
  }

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.getNextStop = getNextStop;
  window.RapidKL.getStopsForRoute = getStopsForRoute;
  window.RapidKL.getTimeUntil = getTimeUntil;
  window.RapidKL.getAllStopDistances = getAllStopDistances;
})();
