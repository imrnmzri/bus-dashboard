<p align="center">
  <img src="assets/icon-180.png" width="80" alt="RapidKL Bus Tracker">
</p>

<h1 align="center">RapidKL Bus Tracker</h1>

<p align="center">
  <strong>Live bus tracking for Kuala Lumpur &mdash; see every bus on a map, get GPS-based ETAs, one tap from your home screen.</strong>
</p>

<p align="center">
  <a href="https://imrnmzri.github.io/bus-dashboard"><strong>Open the Dashboard</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#how-to-use">How to Use</a>
  &nbsp;&middot;&nbsp;
  <a href="#save-it-to-your-phone">Save to Your Phone</a>
  &nbsp;&middot;&nbsp;
  <a href="#faq">FAQ</a>
</p>

## What It Does

**See every bus on a live map.** Buses update every few seconds — tap any one to see its plate number, speed, and last location.

**GPS-based ETAs.** When a bus is on the road, the dashboard measures the actual road distance from the bus to your stop and converts it to minutes. No guesswork from a fixed timetable.

**One tap from anywhere.** Save your regular route and stop once. After that, open the dashboard and tap your saved pill — you're looking at your next bus in seconds. No menus, no typing, no login.

**Free. No ads. No app store.** Just a website that works on any phone, tablet, or desktop. Add it to your home screen and it opens fullscreen like any other app.

## How to Use

### 1. Open the dashboard
Tap the link above on your phone or desktop. Every active RapidKL bus appears on the map.

### 2. Choose your route
Pick your bus from the dropdown. The map zooms in and draws the exact path it follows.

### 3. Choose your stop
Select where you're waiting. The bottom bar shows minutes until the next bus.

### 4. Read the ETA
**Green** means there's a bus on the road and the time is from its GPS position. **White** means no bus is nearby, so it falls back to schedule data — either exact timetables or frequency-based intervals.

### 5. Save your stop
Tap the **+** to save this route and stop. It appears as a pill at the top — tap it anytime to jump straight back.

### 6. Tap a bus
Tap any bus icon on the map to see its plate number, speed, and last update.


## Save It to Your Phone

Works like a normal app — no app store required.

| Platform | Steps |
|----------|-------|
| **iPhone / iPad** | Open in Safari → Tap **Share** → **Add to Home Screen** |
| **Android** | Open in Chrome → Tap **⋮** → **Add to Home Screen** |

It opens fullscreen without browser tabs or address bars. Schedule data is cached on your phone and works offline. Live bus positions need a connection.


## How It Works

- **Live bus positions** stream from Prasarana's real-time WebSocket feed via Socket.IO.
- **Routes, stops, and schedules** come from Malaysia's [Open API](https://developer.data.gov.my/) GTFS data, refreshed weekly and compressed for offline use.
- **GPS-based ETAs** measure road distance from each bus to your stop using Haversine calculation along route shape polylines, with a 1.2x road factor to account for path deviations.
- **Schedule fallback** uses GTFS data — exact `stop_times` for timetabled routes, or frequency intervals (`frequencies.txt`) for headway-based routes — filtered by the active service day.
- **Departure collection** runs on a separate Render service, observing bus movements 24/7 and committing observed headways back to this repo daily.
- **Offline support** — schedule data and the app shell are cached via service worker. Only live positions need a connection.


## FAQ

**Why is the time white instead of green?**
Green means a bus is on the road and the ETA comes from its real GPS position — it's a live measurement. White means no bus is currently nearby on that route, so the time is computed from schedule data instead.

**How accurate is the ETA?**
Green times account for the bus's actual speed and road distance. They're as accurate as the GPS data Prasarana publishes, plus some margin for traffic. White times are schedule approximations — for frequency-based routes they're derived from headway intervals (e.g. every 15 minutes), not exact departure times.

**Does it work without internet?**
Schedules are cached on your phone and work offline. Live bus positions and the map tiles need a connection.

**Where does the data come from?**
Live bus positions come from Prasarana's real-time feed. Routes, stops, and timetables come from Malaysia's Open API GTFS data. The map uses CARTO Voyager tiles.

**Who made this?**
A bus rider who got tired of guessing whether to run for the stop or wait for the next one.
