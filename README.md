# mileage

Personal walking-miles tracker for [michaelmartin.co/miles](https://www.michaelmartin.co/miles).

A small JS widget embedded in a Squarespace page POSTs daily entries to a Google Apps Script web app, which writes to a Google Sheet and serves stats back.

## Files

- **`miles.html`** — page markup, styles, and page-level JS. Pasted into a Squarespace code block.
- **`miles-tracker.js`** — the `MilesTracker` client. Served via jsDelivr at `https://cdn.jsdelivr.net/gh/twoseam/mileage@main/miles-tracker.js`.
- **`code.gs`** — Google Apps Script backend. Edit the deployed copy in the Apps Script console; this file mirrors it.

## Deploying changes

- **JS** — push to `main`; jsDelivr serves the new file (cache may take up to ~12h to invalidate; append `?v=N` to bust).
- **HTML** — paste the contents of `miles.html` into the Squarespace code block on `/miles`.
- **Backend** — paste `code.gs` into the Apps Script editor → Save → Manage deployments → New version → Deploy.
