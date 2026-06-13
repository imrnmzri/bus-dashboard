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

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
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
      color: '#2563eb',
      weight: 3.5,
      opacity: 0.85,
      smoothFactor: 1,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);

    L.circleMarker(latlngs[0], { radius: 5, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.9, weight: 0 }).addTo(routeLayer);
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.9, weight: 0 }).addTo(routeLayer);

    currentShapeBounds = line.getBounds();
    map.fitBounds(currentShapeBounds, { padding: [50, 50], maxZoom: 15 });
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
        fillColor: isSelected ? '#2563eb' : '#94a3b8',
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
        fillColor: isSelected ? '#2563eb' : '#94a3b8',
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
        map.panTo([s.lat, s.lon], { animate: true, duration: 0.5 });
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
      var label = v.vehicle_label || v.bus_no || '';

      var html = '<div class="bus-marker-inner" style="transform:rotate(' + rotation + 'deg)">' +
        '<svg width="32" height="32" viewBox="0 0 32 32">' +
        '<circle cx="16" cy="16" r="11" fill="white" stroke="#2563eb" stroke-width="2.5"/>' +
        '<polygon points="16,8 20,16 16,14 12,16" fill="#2563eb"/>' +
        '</svg></div>';

      var popupContent = '<div class="bus-popup">' +
        '<strong>' + label + '</strong>' +
        '<br>GPS: ' + (v.gps_time || '--') +
        '<br>Speed: ' + (v.speed || 0) + ' km/h' +
        '</div>';

      var marker = L.marker(latlng, {
        icon: L.divIcon({ className: 'bus-marker-icon', html: html, iconSize: [32, 32], iconAnchor: [16, 16] }),
        zIndexOffset: 1000
      });

      marker.bindPopup(popupContent, { className: 'bus-popup-wrapper', closeButton: false, offset: [0, -16] });

      if (label) {
        marker.bindTooltip(label, {
          direction: 'bottom',
          offset: [0, 16],
          permanent: true,
          className: 'bus-tooltip'
        });
      }

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
