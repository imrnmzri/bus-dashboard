# RapidKL Bus Tracker

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-deployed-brightgreen)](https://github.com)
[![Static Data](https://img.shields.io/badge/static%20data-refreshed%20weekly-blue)](https://github.com)
[![PWA Ready](https://img.shields.io/badge/PWA-ready-5a0fc8)](https://github.com)

Live bus tracking dashboard for RapidKL buses in Kuala Lumpur. Pin to your iPhone home screen for a native app experience.

<p align="center">
  <img src="assets/icon-512.png" alt="RapidKL Tracker" width="120" />
</p>

---

## Features

- **Live ETA** — Arrival times calculated from real-time bus GPS positions along route shapes, not just static schedules
- **Quick Dial** — Save favorite route + stop combinations for one-tap access. Auto-restores last-used on revisit
- **Live Map** — OpenStreetMap with route polylines and directional bus markers updated every 5 seconds
- **Bus Popups** — Tap any marker to see plate number, GPS timestamp, and speed
- **Route & Stop Slicer** — Filter to a specific route, then drill down to a specific stop
- **Minutes Display** — Large countdown in minutes until next arrival (not wall-clock math)
- **PWA** — Install to iPhone home screen. Runs standalone with splash screen and no browser chrome
- **Smart Socket** — WebSocket connects when page is visible, disconnects when blurred to conserve data

## Architecture

```
┌──────────────────────┐     ┌──────────────────────────┐
│  api.data.gov.my      │     │  Prasarana Socket.io AVL  │
│  GTFS Static (weekly) │     │  Live bus positions (5s)  │
└──────────┬───────────┘     └────────────┬─────────────┘
           │ GitHub Action                │ WebSocket
           │ build-static.js              │ + pako gzip
           ▼                              ▼
┌──────────────────────────────────────────────────────┐
│                 GitHub Pages (static site)            │
│  ┌────────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Leaflet    │  │ Next Arr │  │ Quick Dial Chips │ │
│  │ OSM Map    │  │ (minutes)│  │ [300·KLCC] [+]   │ │
│  │ + shapes   │  │ ● Live   │  │ [T808·MRT]       │ │
│  └────────────┘  └──────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Clone
git clone https://github.com/YOUR_USER/bus-dashboard.git
cd bus-dashboard

# Install dependencies (for build script only)
npm install

# Build static GTFS data
node scripts/build-static.js

# Serve locally
npx serve . -l 3000
# Open http://localhost:3000
```

## Data Sources

| Source | Endpoint | Refresh |
|--------|----------|---------|
| Vehicle Positions | `rapidbus-socketio-avl.prasarana.com.my` (Socket.io) | ~5 seconds |
| Static Schedule | `api.data.gov.my/gtfs-static/prasarana` (2 categories) | Weekly via GitHub Action |

The [data.gov.my Open API](https://developer.data.gov.my/realtime-api/gtfs-realtime) provides public GTFS-R feeds. The live vehicle positions use Prasarana's internal Socket.io endpoint — the same one powering the [official RapidKL kiosk](https://myrapidbus.prasarana.com.my/kiosk).

### Route Coverage

Both categories are merged for complete coverage:

| Category | Routes | Example |
|----------|--------|---------|
| `rapid-bus-kl` | ~127 | 300, 450, 650, SUNWAY LINE |
| `rapid-bus-mrtfeeder` | ~91 | T807, T808, T811, T850 |
| **Total** | **218** | — |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Map | [Leaflet.js](https://leafletjs.com/) + OpenStreetMap tiles |
| Real-time | [Socket.io](https://socket.io/) v2 + [Pako](https://nodeca.github.io/pako/) gzip |
| Scheduling | Haversine distance + shape-projected ETA |
| Storage | localStorage (schedule cache, favorites, last-used) |
| PWA | Service Worker + Web App Manifest + Apple meta tags |
| Static Build | Node.js + [JSZip](https://stuk.github.io/jszip/) + [PapaParse](https://www.papaparse.com/) |
| CI/CD | GitHub Actions (weekly static data refresh) |
| Hosting | GitHub Pages |

## PWA Installation (iPhone)

1. Open the deployed URL in Safari
2. Tap the **Share** button (bottom center)
3. Scroll down and tap **Add to Home Screen**
4. Name it and tap **Add**

The dashboard will open as a standalone app with no browser chrome.

## Static Data Refresh

A GitHub Action runs every Monday at 4 AM UTC:

```yaml
# .github/workflows/refresh-static.yml
schedule: '0 4 * * 1'
```

It downloads fresh GTFS ZIPs, builds `data/static.json.gz`, and commits the update. The dashboard loads this file from the same origin — zero CORS, zero runtime ZIP parsing.

To run manually:

```bash
node scripts/build-static.js
```

## Project Structure

```
bus-dashboard/
├── index.html                 # SPA shell + PWA meta
├── manifest.json              # PWA manifest
├── sw.js                      # Service worker (network-first)
├── css/style.css              # Light theme, mobile-first
├── js/
│   ├── app.js                 # State, init, favorites wiring, route resolution
│   ├── gtfs-static.js         # Fetch static.json.gz → localStorage cache
│   ├── live-socket.js         # Socket.io → pako decompress → live positions
│   ├── scheduler.js           # Live ETA (shape distance) + schedule fallback
│   ├── map.js                 # Leaflet map, route lines, bus markers, popups
│   ├── ui.js                  # Clock display, dropdowns, status indicators
│   └── favorites.js           # Quick dial persistence in localStorage
├── data/
│   └── static.json.gz         # Pre-built GTFS (routes, stops, trips, shapes)
├── scripts/
│   └── build-static.js        # Node: download GTFS ZIPs → static.json.gz
├── assets/
│   ├── icon-180.png
│   └── icon-512.png
├── .github/workflows/
│   └── refresh-static.yml     # Weekly cron for static data
└── AGENTS.md                  # Developer notes
```

## License

MIT
