# RapidKL Bus Tracker

Live bus tracking for RapidKL buses in Kuala Lumpur — built for your iPhone home screen.

**[Open Dashboard](#)** &nbsp;·&nbsp; Pin to iPhone for a native app experience

---

## How to Use

### 1. Open the Dashboard

Visit the live site on your phone or desktop. The map shows all active RapidKL buses in real time.

### 2. Pick Your Route

Use the **Route** dropdown to select a bus line (e.g., 300, T808). The map filters to show only that route's buses and draws the route path.

### 3. Pick Your Stop

After selecting a route, choose a stop from the **Stop** dropdown. The dashboard calculates the next arrival time at that stop.

### 4. Read the Clock

The large number is **minutes until the next bus arrives**. A green **● Live** badge means the time is calculated from actual bus GPS positions — not a printed schedule. An amber **Scheduled** badge falls back to timetable data when no bus is actively approaching.

### 5. Save Favorites

Tap the **+** button to save your current route and stop to Quick Dial. Your saved combos appear as pills at the top — tap one to jump straight there on your next visit. The dashboard auto-restores your last-used selection.

### 6. Tap Buses on the Map

Tap any bus marker to see its plate number, GPS timestamp, and speed.

---

## Install on iPhone (PWA)

1. Open the dashboard in **Safari**
2. Tap the **Share** button (square with arrow at the bottom)
3. Scroll down and tap **Add to Home Screen**
4. Name it and tap **Add**

The dashboard opens fullscreen like a native app. No browser chrome, no Safari tabs.

---

## What It Tracks

- **600+ live buses** across 218 RapidKL routes in Kuala Lumpur
- Positions update every ~5 seconds
- ETA calculated from bus GPS distance along the actual route shape
- Scheduled arrivals as fallback when no bus is nearby

---

## Data

| Data | Source | Refresh |
|------|--------|---------|
| Bus positions | Prasarana AVL (live socket) | ~5 seconds |
| Routes & schedules | data.gov.my Open API | Weekly |

This project uses Malaysia's official [Open API](https://developer.data.gov.my/) for GTFS data. All route schedules are publicly available.

---

## FAQ

**Why does it show "Scheduled" instead of "Live"?**  
No bus is currently on the selected route within range of your stop. The time shown is from the official timetable.

**Why are some buses missing from the map?**  
The socket feed may not include every bus at every moment. Switch to "All routes" in the dropdown to see everything available.

**Does it work offline?**  
The app caches schedules locally. Bus positions require an internet connection.

**Can I use it on Android?**  
Yes — open in Chrome and tap "Add to Home Screen" from the menu.

---

## For Developers

To run locally or contribute:

```bash
git clone https://github.com/YOUR_USER/YOUR_REPO.git
cd YOUR_USER.YOUR_REPO
npm install
node scripts/build-static.js
npx serve . -l 3000
```

See [AGENTS.md](AGENTS.md) for full architecture docs.
