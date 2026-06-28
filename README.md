<p align="center">
  <img src="assets/icon-180.png" width="80" alt="RapidKL Bus Tracker">
</p>

<h1 align="center">RapidKL Bus Tracker</h1>

<p align="center">
  <strong>Live bus tracking for Kuala Lumpur &mdash; free, fast, and installable as a native app.</strong>
</p>

<p align="center">
  <a href="#"><strong>Open Dashboard</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#install-as-an-app">Install as an App</a>
  &nbsp;&middot;&nbsp;
  <a href="#faq">FAQ</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/buses_live-600+-green" alt="600+ live buses">
  <img src="https://img.shields.io/badge/routes-218-blue" alt="218 routes">
  <img src="https://img.shields.io/badge/data-open_data-red" alt="Open data">
</p>

---

## What is this?

Imagine standing at a bus stop wondering when the next bus will arrive. This dashboard shows you &mdash; in real time, on a map, for every RapidKL bus in Kuala Lumpur. It calculates the **minutes until your bus arrives** using actual GPS positions, not paper timetables.

No app store. No account. No ads. Just open the website and you're tracking.

## How to Use

<p align="center"><i>It takes 10 seconds.</i></p>

**1. Open the dashboard** on your phone or desktop. You'll see every active RapidKL bus moving across the map.

**2. Pick a route.** Tap the dropdown and choose your bus line (like `300` or `T808`). The map zooms to that route and draws the exact path the bus follows.

**3. Pick a stop.** After choosing a route, select your stop from the second dropdown. The bottom bar shows the **minutes until the next bus arrives**.

**4. Check the color.** The time turns <span style="color:#34d399">**green**</span> when it's calculated from an actual bus's GPS position. If it stays white, no bus is currently nearby so it falls back to the official timetable.

**5. Save your combo.** Tap the **+** button to save your route &amp; stop to Quick Dial. Your favorites appear as pills at the top &mdash; one tap and you're back.

**6. Tap a bus.** Tap any bus marker on the map to see its plate number, last GPS ping, and speed.

## Install as an App

No app store needed. The dashboard is a PWA &mdash; add it to your home screen and it works fullscreen, just like a native app.

**iPhone / iPad** &mdash; open in Safari, tap **Share**, then **Add to Home Screen**.

**Android** &mdash; open in Chrome, tap the menu (**&vellip;**), then **Add to Home Screen**.

It opens without browser chrome, tabs, or address bar on either platform.

## What It Tracks

| | |
|---|---|
| **Live buses** | 600+ buses across 218 routes, positions refresh every ~5 seconds |
| **GPS-based ETA** | Arrival time calculated from actual bus distance along the road to your stop |
| **Timetable fallback** | When no bus is nearby, shows the next scheduled departure |
| **Quick Dial** | Save your favorite route+stop combos for one-tap access |

## Where The Data Comes From

This dashboard runs on **public open data**. Nothing is scraped or reverse-engineered.

| Data | Source | Freshness |
|------|--------|-----------|
| **Bus positions** | Prasarana live AVL feed | Every 5 seconds |
| **Routes, stops, schedules** | Malaysia [Open API](https://developer.data.gov.my/) (GTFS) | Refreshed weekly |

The bus positions stream from Prasarana's official real-time feed over WebSocket. Route maps and timetables come from Malaysia's open data portal, rebuilt automatically every week via a GitHub Action so you're never looking at stale schedules.

The dashboard also connects smart &mdash; when you switch tabs or lock your phone, it disconnects from the live feed to save power. Reconnects the moment you come back.

## Tech Stack

Vanilla JavaScript, no frameworks. Served from GitHub Pages. Built with:

- **Leaflet** for the map
- **Socket.io** for real-time bus positions
- **Pako** for decompressing data on the fly
- **PWA** so it works offline and installs like an app

Everything loads from CDN. The site is about 2.9 MB of compressed route data &mdash; cached for a week in your browser &mdash; so repeat visits are instant.

## FAQ

**Why is the time white instead of green?**
Green means a bus is actively approaching your stop and the time is from its GPS. White means no bus is on that route nearby, so it's showing the timetable instead.

**Why are some buses missing?**
The live feed may not include every bus at every instant. Switch to "All routes" to see everything available.

**Does it work offline?**
Route schedules are cached locally. Live bus positions need an internet connection.

**Who made this?**
A bus rider who got tired of guessing. The code is open source (MIT) &mdash; contributions welcome.

---

<p align="center">
  <sub>Built with &#129302; for everyone waiting at a bus stop. <a href="https://github.com/imrnmzri/bus-dashboard">Source on GitHub</a>.</sub>
</p>
