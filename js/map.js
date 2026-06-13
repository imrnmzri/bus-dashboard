(function() {
  'use strict';

  var map = null;
  var routeLayer = null;
  var busLayer = null;
  var stopLayer = null;
  var currentShapeBounds = null;
  var currentStops = [];
  var currentSelectedStopId = null;

  function initMap() {
    if (map) return;

    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    }).setView([3.139, 101.6869], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> | &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

    routeLayer = L.layerGroup().addTo(map);
    busLayer = L.layerGroup().addTo(map);
    stopLayer = L.layerGroup().addTo(map);

    console.log('[map] Ready');
  }

  function drawRoute(shapePoints) {
    routeLayer.clearLayers();
    currentShapeBounds = null;
    if (!shapePoints || shapePoints.length < 2) return;

    var latlngs = [];
    for (var i = 0; i < shapePoints.length; i++) {
      latlngs.push([shapePoints[i].lat, shapePoints[i].lng]);
    }

    var line = L.polyline(latlngs, {
      color: '#e85d04',
      weight: 3.5,
      opacity: 0.85,
      smoothFactor: 1,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);

    L.circleMarker(latlngs[0], { radius: 5, color: '#e85d04', fillColor: '#e85d04', fillOpacity: 0.9, weight: 0 }).addTo(routeLayer);
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: '#e85d04', fillColor: '#e85d04', fillOpacity: 0.9, weight: 0 }).addTo(routeLayer);
  }

  function clearRoute() {
    routeLayer.clearLayers();
    stopLayer.clearLayers();
    currentShapeBounds = null;
    currentStops = [];
    currentSelectedStopId = null;
    map.setView([3.139, 101.6869], 13);
  }

  function drawStops(stops, selectedStopId) {
    stopLayer.clearLayers();
    currentStops = stops || [];
    currentSelectedStopId = selectedStopId || null;

    if (!stops || stops.length === 0) return;

    for (var i = 0; i < stops.length; i++) {
      var s = stops[i];
      if (!s.lat || !s.lon) continue;

      var isSelected = selectedStopId && s.stop_id === selectedStopId;
      var cls = 'stop-marker' + (isSelected ? ' selected' : '');

      var marker = L.circleMarker([s.lat, s.lon], {
        radius: isSelected ? 6 : 4,
        fillColor: isSelected ? '#e85d04' : '#64748b',
        color: 'white',
        weight: 1.5,
        fillOpacity: 1,
        opacity: 1,
        zIndexOffset: isSelected ? 500 : 100
      });

      marker.bindTooltip(s.name || s.stop_id, {
        direction: 'top',
        offset: [0, -4],
        className: 'bus-tooltip'
      });

      marker.addTo(stopLayer);
    }

    if (!selectedStopId && stops.length > 0) {
      var bounds = L.latLngBounds();
      for (var k = 0; k < stops.length; k++) {
        if (stops[k].lat && stops[k].lon) bounds.extend([stops[k].lat, stops[k].lon]);
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
    }
  }

  function highlightStop(stopId) {
    if (!currentStops.length) return;

    currentSelectedStopId = stopId || null;
    stopLayer.clearLayers();

    for (var i = 0; i < currentStops.length; i++) {
      var s = currentStops[i];
      if (!s.lat || !s.lon) continue;

      var isSelected = stopId && s.stop_id === stopId;

      var marker = L.circleMarker([s.lat, s.lon], {
        radius: isSelected ? 6 : 4,
        fillColor: isSelected ? '#e85d04' : '#64748b',
        color: 'white',
        weight: 1.5,
        fillOpacity: 1,
        opacity: 1,
        zIndexOffset: isSelected ? 500 : 100
      });

      marker.bindTooltip(s.name || s.stop_id, {
        direction: 'top',
        offset: [0, -4],
        permanent: isSelected,
        className: 'bus-tooltip'
      });

      marker.addTo(stopLayer);

      if (isSelected) {
        map.setView([s.lat, s.lon], 16, { animate: true, duration: 0.5 });
      }
    }
  }

  function updateBuses(vehicles, selectedRouteId) {
    busLayer.clearLayers();

    var filtered = vehicles;
    if (selectedRouteId) {
      filtered = [];
      for (var i = 0; i < vehicles.length; i++) {
        if (vehicles[i].route_id === selectedRouteId) {
          filtered.push(vehicles[i]);
        }
      }
    }

    for (var j = 0; j < filtered.length; j++) {
      var v = filtered[j];
      var latlng = [v.lat, v.lng];
      if (latlng[0] === 0 && latlng[1] === 0) continue;

      var rotation = v.bearing || 0;

      var html = '<div class="bus-marker-inner" style="transform:rotate(' + rotation + 'deg)">' +
        '<svg width="32" height="32" viewBox="0 0 32 32">' +
        '<circle cx="16" cy="16" r="11" fill="white" stroke="#e85d04" stroke-width="2.5"/>' +
        '<polygon points="16,8 20,16 16,14 12,16" fill="#e85d04"/>' +
        '</svg></div>';

      var popupContent = '<div class="bus-popup">' +
        '<strong>' + (v.vehicle_label || v.bus_no || '') + '</strong>' +
        '<br>GPS: ' + (v.gps_time || '--') +
        '<br>Speed: ' + (v.speed || 0) + ' km/h' +
        '</div>';

      var marker = L.marker(latlng, {
        icon: L.divIcon({ className: 'bus-marker-icon', html: html, iconSize: [32, 32], iconAnchor: [16, 16] }),
        zIndexOffset: 1000
      });

      marker.bindPopup(popupContent, { className: 'bus-popup-wrapper', closeButton: false, offset: [0, -16] });
      marker.addTo(busLayer);
    }
  }

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.initMap = initMap;
  window.RapidKL.drawRoute = drawRoute;
  window.RapidKL.clearRoute = clearRoute;
  window.RapidKL.updateBuses = updateBuses;
  window.RapidKL.drawStops = drawStops;
  window.RapidKL.highlightStop = highlightStop;
})();
