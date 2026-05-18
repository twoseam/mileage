# mileage

Personal walking/running mileage tracker. Static site on GitHub Pages, backed by
a Google Apps Script web app that reads/writes a Google Sheet.

**Live:** https://twoseam.github.io/mileage/

## Pages

- **`index.html`** — entry page: log a walk/run (date, miles, time & pace, shoe, notes).
- **`stats.html`** — swipeable charts by week / month / year / all.
- **`shoes.html`** — shoe roster: lifetime miles, wear vs. goal, photos, retire.
- **`nav.js`** — shared slide-out menu (injected on every page).
- **`miles-tracker.js`** — `MilesTracker` client; talks to the Apps Script endpoint.
- **`code.gs`** — Apps Script backend (mirror of the deployed script).
- **`migration.gs`** — one-off historical migration (already run; kept for reference).

## Data model

Google Sheet, two tabs, both read/written **by header name** (columns can be reordered):

- **Entries** — Date, Miles, Walk/Run, Start Time, End Time, Pace, Lat, Lon, Temp, Weather, Shoe, Notes
- **Shoes** — Brand, Model, Color, Goal, Purchased, Retired, Photo(s), Pair, Notes

A walk is credited to a shoe when its **Shoe** text matches the pair's identity
(brand + model + color, plus a copy number for duplicates).

## Deploying changes

- **Site** — commit & push to `main`; GitHub Pages serves it (hard-refresh / `?v=N` to bust cache).
- **Backend** — paste `code.gs` into the Apps Script editor → Save → **Deploy → Manage
  deployments → New version → Deploy**. (Saving alone does *not* deploy.) Shoe photos
  need a `GITHUB_TOKEN` script property and the external-request scope authorized once.
