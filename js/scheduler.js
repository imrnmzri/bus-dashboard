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

  // Haversine distance in km between two lat/lng points
  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Find closest point on a shape polyline, return cumulative distance from start
  function closestOnShape(lat, lng, shape, cumDist) {
    var bestDist = Infinity;
    var bestCum = 0;
    var bestLat = shape[0].lat;
    var bestLng = shape[0].lng;

    for (var i = 0; i < shape.length - 1; i++) {
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
      }
    }

    return { distance: bestCum, lat: bestLat, lng: bestLng, snapDist: bestDist };
  }

  // Get the shape for a route
  function getRouteShape(routeId, staticData) {
    if (!staticData || !staticData.shapes || !staticData.trips) return null;
    for (var tid in staticData.trips) {
      if (staticData.trips[tid].route_id === routeId && staticData.trips[tid].shape_id) {
        var s = staticData.shapes[staticData.trips[tid].shape_id];
        if (s && s.length >= 2) return s;
      }
    }
    return null;
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

    var shape = getRouteShape(selectedRouteId, staticData);
    if (!shape) return null;

    var cumDist = buildCumDist(shape);
    var stop = staticData.stops ? staticData.stops[selectedStopId] : null;
    if (!stop) return null;

    var stopSnap = closestOnShape(stop.lat, stop.lon, shape, cumDist);
    var best = null;

    for (var i = 0; i < vehicles.length; i++) {
      var v = vehicles[i];
      if (v.route_id !== selectedRouteId) continue;

      var busSnap = closestOnShape(v.lat, v.lng, shape, cumDist);

      // Only consider buses approaching the stop (not past it)
      if (busSnap.distance >= stopSnap.distance) continue;

      // Bus must be within ~100m of the shape to be considered on route
      if (busSnap.snapDist > 0.3) continue; // 300m max snap distance

      var remainingKm = stopSnap.distance - busSnap.distance;
      var speedKmh = v.speed > 3 ? v.speed : 25; // minimum 25 km/h for stopped buses

      // Apply a road factor: shape distance * 1.2 to account for deviations
      var etaSeconds = (remainingKm * 1.2 / speedKmh) * 3600;

      if (!best || etaSeconds < best.seconds) {
        best = {
          seconds: etaSeconds,
          vehicleLabel: v.vehicle_label || '',
          remainingKm: remainingKm,
          speedKmh: speedKmh
        };
      }
    }

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
      stopLng: stop.lon
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
        if (arrival >= 86400) arrival = arrival % 86400;
        if (arrival <= nowSeconds) arrival += 86400;

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
          if (arrival >= 86400) arrival = arrival % 86400;
          if (arrival <= nowSeconds) arrival += 86400;

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

  function getStopsForRoute(routeId, staticData) {
    if (!routeId || !staticData) return [];
    var stopMap = {}, orderMap = {};
    var firstTrip = null;

    for (var tid in staticData.trips) {
      if (staticData.trips[tid].route_id === routeId && staticData.trips[tid].stop_times && staticData.trips[tid].stop_times.length > 0) {
        firstTrip = staticData.trips[tid];
        break;
      }
    }
    if (!firstTrip) return [];

    for (var i = 0; i < firstTrip.stop_times.length; i++) {
      var st = firstTrip.stop_times[i];
      if (!st.stop_id || stopMap[st.stop_id]) continue;
      stopMap[st.stop_id] = true;
      orderMap[st.stop_id] = i;
    }

    for (var tid2 in staticData.trips) {
      if (staticData.trips[tid2].route_id !== routeId) continue;
      var times = staticData.trips[tid2].stop_times;
      if (!times) continue;
      for (var j = 0; j < times.length; j++) {
        var sid = times[j].stop_id;
        if (!sid || stopMap[sid]) continue;
        stopMap[sid] = true;
        orderMap[sid] = j;
      }
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

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.getNextStop = getNextStop;
  window.RapidKL.getStopsForRoute = getStopsForRoute;
  window.RapidKL.getTimeUntil = getTimeUntil;
})();
