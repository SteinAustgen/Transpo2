# Transpoguide Administrator Guide

## 1. How it works (read first)
Transpoguide is a static website (no server). The admin panel edits a **draft saved in your own browser**. Commuters never see the draft until you **publish** it by replacing `site-data.json` in the repository. Route data from your Google Sheet still syncs live; admin routes are layered on top of it.

| Item | Where it lives | Who sees it |
|---|---|---|
| Announcements, fare settings, admin routes, hidden routes, place coordinates | `site-data.json` (published) | Everyone |
| Your unpublished edits, admin PIN | Your browser (`localStorage`) | Only you, on that browser |
| Commuter reports | The commuter's own device until a backend is connected (section 8) | Admin only after section 8 |

## 2. Deploy the site (once)
1. Put all files in the repo root: `index.html, app.js, enhancements.js, config.js, styles.css, sw.js, site-data.json`.
2. GitHub repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)` → Save.
3. Open the `https://<user>.github.io/<repo>/` link. **HTTPS is required**: GPS ("Use my location"), offline caching and the admin PIN hashing do not work on plain `http://` or `file://` pages (except `localhost`).
4. Admin panel address: add `#admin` to the end, e.g. `https://<user>.github.io/<repo>/#admin`. Do not link it publicly.

## 3. First login and PIN
- First visit asks you to **set a PIN (6+ characters)**; later visits ask for it.
- The PIN is stored per browser. It only keeps casual visitors out; it is **not real security**, because all edits still need you to publish the file. Real login needs a backend (section 9).
- Forgot the PIN: browser DevTools → *Application → Local Storage* → delete `pt_pin` → reload `#admin`. (Your other drafts are kept.)

## 4. Using each tab
**Notices** – Write a message, choose *Advisory / Delay or holiday / Suspension*, optionally a "show until" date, press **Post**. Expired notices hide automatically. **Delete** removes one.

**Fare** – Holds the LTFRB matrix: base fare, base distance (km) and per-extra-km rate for traditional and modern jeepneys, plus the discount % (currently 20% for students, seniors, PWD) and a label such as the effectivity date. Press **Save**. Update this whenever LTFRB publishes a new matrix. The defaults (₱14 / 4 km / ₱2.00 and ₱17 / 4 km / ₱2.40) come from news reports of the Sept 28, 2026 matrix: **verify them against the official LTFRB document before publishing.** UV Express and bus routes use the directory fare from your sheet.

**Routes** – Lists every route (sheet routes and admin routes).
- *Add*: fill the form. Required: Origin, Destination, Regular fare. Student fare is computed from the discount if left blank. Optional Lat/Lon (origin coordinates) make "Near me" and sorting exact. Stopovers appear in the drop-off step.
- *Edit*: press **Edit**, change the form, press **Update**. Editing a sheet route creates an admin copy and hides the original.
- *Delete*: admin routes are removed; sheet routes are **hidden** (the sheet is never changed). To bring a hidden route back, discard local edits or remove its key from `"hidden"` in `site-data.json`.
- **Locate all places (one-time)**: looks up coordinates for every origin and destination (about 1 second per place) and saves them in the draft, so commuters get instant "Near me" and distance sorting. Check a few on a map; wrong ones can be corrected by editing `"coords"` in `site-data.json` (`"place name in lowercase": {"lat": 0, "lon": 0}`). Re-run it after adding new places.

**Reports** – Shows reports saved on this browser, with category, route, suggested fare and contact. **Approve** or **Dismiss** only changes the status; apply the actual fix under Routes or Fare.

**Import** – Bulk-add routes from CSV (Excel: *File → Save As → CSV UTF-8*). Press **Download CSV template** for the header row. Column names are matched loosely (case and symbols ignored).

| Column | Required | Notes |
|---|---|---|
| Start | Yes | Origin station |
| Destination | Yes | |
| Regular Fare | Yes | Number, e.g. `25` |
| Trip Name, Vehicle Type, Signboard / Color | No | Vehicle type containing "modern" uses modern rates |
| Student Fare | No | Blank = computed |
| Drop-off Instructions, Landmark Name, Landmark Description, Landmark Image, Map Link | No | Links must start with `http` |
| Lat, Lon, Stopovers | No | Origin coordinates; stopovers as text |

Rows missing a required value are skipped and counted in the message. A row with the same Start + Destination replaces the existing admin route. `.xlsx` files are not read directly: save as CSV first.

**Publish** – **Download site-data.json**. **Discard local edits** resets your draft to the published file.

## 5. Publishing checklist
1. Make edits → open **Publish** → download `site-data.json`.
2. In GitHub, open the repo → `site-data.json` → pencil/*Upload files* → replace → **Commit**.
3. Wait about 1 minute, then open the site on a phone. Visitors with the site already cached get the update on their **second** load (offline cache refreshes in the background).
4. After changing any code file, increase `V = 'pt-v2'` in `sw.js` (to `pt-v3`, and so on) so every device refreshes its cache.

## 6. What commuters get (for testing)
Selecting a trip shows the fare for Regular, Student, Senior and PWD automatically (LTFRB matrix × estimated distance). "Use my location as origin" sets the origin to the commuter's position, and after they choose a destination the nearest terminal serving it is used. All Routes can sort by nearest, shortest trip, or lowest fare. The Report tab lets commuters flag problems.

## 7. Live traffic and ETA (Google Maps API key)
A key cannot be bundled with the site; it belongs to **your** Google Cloud account and billing. Without a key everything else works, and the map offers a "Google Maps" button for live traffic.
1. Go to <https://console.cloud.google.com> → create a project → **Billing** → link a billing account (Google gives a free monthly usage allowance; check current pricing).
2. **APIs & Services → Library**: enable **Maps JavaScript API** and **Routes API**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. **Restrict the key** (mandatory, because it is visible in the page source): *Application restrictions → Websites*, add `https://<user>.github.io/*`; *API restrictions → Restrict key* → select the two APIs above.
5. Set a **budget alert** in Billing so unexpected usage is reported.
6. Open `config.js` and paste the key: `GOOGLE_MAPS_API_KEY: 'AIza...'`. Commit it and reload the site twice.
7. Open a trip: the map becomes interactive with the live traffic layer, and "Live ETA by road" appears under it (refreshes every 5 minutes). The ETA is for road traffic; jeepneys stop often, so treat it as a guide.
If you see "key was rejected", recheck the referrer pattern, the enabled APIs and billing.

## 8. Shared commuter reports (optional backend, free)
1. Create a Google Sheet with a tab named `Reports` (headers: time, type, route, fare, contact, details, status).
2. *Extensions → Apps Script*, paste, then **Deploy → New deployment → Web app** (Execute as: *Me*, Access: *Anyone*) and copy the URL:
```js
function doPost(e) {
  const r = JSON.parse(e.postData.contents);
  SpreadsheetApp.getActive().getSheetByName('Reports')
    .appendRow([r.ts, r.type, r.route, r.fare, r.contact, r.text, 'pending']);
  return ContentService.createTextOutput('ok');
}
```
3. In `enhancements.js` set `const REPORT_ENDPOINT = 'https://script.google.com/macros/s/.../exec';` and commit.
4. Moderate in the Sheet (change `pending` to `approved` or `dismissed`), then apply fixes in the admin panel. The in-app Reports tab only shows reports made on the same browser.

## 9. Improving the module later
- **Edit points in `enhancements.js`**: `DEFAULTS` (fare defaults), `FIELDS` (route form), `ALIAS` (CSV column names), `REPORT_ENDPOINT`, `TABS` (admin tabs).
- **Real accounts and shared admin editing**: move the draft into Supabase or Firebase (database plus login) and replace `save()` / `loadDB()`. This also removes the manual publish step and delivers reports straight to the panel.
- **Precision**: replace straight-line distances with Routes API distances once the key is active.
- Keep editing through the panel or the files listed here, and re-run the checklist in section 5.

## 10. Troubleshooting
| Symptom | Fix |
|---|---|
| "Use my location" does nothing | Use HTTPS; allow location in browser settings |
| Nearest terminal takes ~20 s the first time | Run **Locate all places**, publish `site-data.json` |
| Changes not visible to others | You did not publish; follow section 5 and reload twice |
| `#admin` shows nothing | Wrong PIN, or pop-ups/prompts blocked for the site |
| Import says "skipped" | Missing Start, Destination or Regular Fare in those rows |
| No live ETA | Section 7: key, APIs, billing, referrer pattern |
| Old design after a code update | Increase `V` in `sw.js` |
| A route shows wrong fare | Fix it in Routes, or in the Google Sheet if it is a sheet row |
