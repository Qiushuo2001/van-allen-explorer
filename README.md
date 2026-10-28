# Van Allen Mission Explorer

A browser-based HTML/CSS/JavaScript application for the **definitive NASA SSCWeb ephemerides** of Van Allen Probe A (`rbspa`) and Probe B (`rbspb`). Includes interactive Three.js navigation, UTC time selection, mission/interval timelines, playback, configurable trajectory windows, GSE/GSM/GEO coordinates, per-probe availability, source-data import/export, and measured **AE/Dst geomagnetic index panels**.

## Use online

Open **[Van Allen Mission Explorer](https://qiushuo2001.github.io/van-allen-explorer/)** in a current browser with WebGL enabled. No installation or local server is needed. The app includes the March 2015 dataset and retrieves other mission dates directly from NASA services.

GitHub Pages publishes the root of the `main` branch. Pushing changes to `main` automatically updates the site. The `.nojekyll` file keeps the HTML, JavaScript, and scientific data as static files, without Jekyll processing.

## Run locally

Extract the ZIP, open a terminal in the `van-allen-explorer` directory, and run either:

```sh
node tools/serve.mjs
```

or, with Python:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open **http://127.0.0.1:8000** in a current browser with WebGL enabled. Stop the server with Ctrl+C. No package installation, API key, account, or build is needed. Node 18+ or Python 3.10+ is sufficient. If port 8000 is occupied, use another port with Python, e.g. `python -m http.server 8001 --bind 127.0.0.1`.

Use a local HTTP server: double-clicking `index.html` as a `file:` URL prevents module/data loading in many browsers.

The included NASA dataset covers **2015-03-16 00:00:00 through 2015-03-19 00:00:00 UTC**, inclusive, for both probes and all three frames. It contains 4,321 records per probe. This interval works completely offline. Other mission dates fetch real SSCWeb data on demand; the entire mission is not bundled.

## Explore

- Enter a date and time in **UTC**. The date picker has no local-time conversion, regardless of your computer’s timezone.
- Use **Mission** for the full date range or **Playback interval** for a finer timeline. The minute buttons make precise sample stepping easy.
- Enter playback From/To values and press **Apply**. **Use selected day** creates a daily interval. Set the playback speed and optionally Loop. Playback steps through source minutes; it pauses while retrieving a new window. A hidden browser tab does not advance playback.
- **Play starts from the selected time**, advancing to the next UTC minute if necessary. If that time is outside the current playback interval, the interval moves to start at your selection, keeps its previous duration, and is shortened at the mission end. The From/To fields and timeline update together. Playback never returns to the bundled example because a requested date has not been downloaded; it retrieves that date or reports unavailable data.
- Rotate with left-drag, zoom with the wheel/pinch, and pan with right-drag. **3D / XY / XZ** choose views; **↺** resets the camera. Each probe has an independent visibility toggle.
- Select GSE, GSM or GEO and a trajectory half-window from ±1 to ±24 hours. Solid paths are past records, dashed paths future records relative to the selected time.
- Each probe also shows **L, MLT, and MLAT**, matched to its plotted position sample. The magnetic values use SSCWeb's centered-dipole/SM convention regardless of the Cartesian frame selected for the 3D view.
- **Export** saves loaded raw responses with provenance. **Import data** accepts that bundle, the downloader’s bundle, or raw SSCWeb JSON responses. Imports remain in memory until reload; put permanent downloads in `data/` using the downloader.

## Temporal accuracy and gaps

**An arbitrary time can be selected, but an exact position can only be displayed when the archive contains a sample at that time.** The native cadence is 60 seconds. The app never computes/interpolates/propagates a spacecraft position.

By default, a time between records has no marker or coordinate value. The optional **Show nearest sample within 30 seconds** displays a real adjacent record, explicitly showing its own UTC and offset from your selection. It requires two contiguous bounding records and never extrapolates before/after coverage or bridges a gap. Nearest records are not represented as positions at the requested time.

Trajectory lines are straight drawing segments between consecutive records, not analytical or simulated orbits. A missing minute, rejected invalid record, or discontinuity breaks the line. Playback may skip displayed minutes at high speed; it still uses only archived positions. The display’s decimal places do not imply an orbit-determination uncertainty.

## L, MLT, and MLAT

The magnetic readouts use additional **NASA SSCWeb** responses for definitive `rbspa` and `rbspb` ephemerides at native 60-second cadence. They are magnetic-model coordinates, not direct magnetic-field measurements.

| Readout | NASA field | Convention |
|---|---|---|
| L | `DipoleLValue` | Centered-dipole L, dimensionless; equatorial crossing distance normalized by Earth's radius. |
| MLT, h | SM `LocalTime` | Magnetic local time in decimal hours; 0 is midnight and 12 is noon. |
| MLAT, ° | SM `Latitude` | Magnetic latitude at the spacecraft, relative to the magnetic equator. |

This L is **not McIlwain L or drift-shell L\***; those require a different field-model product. MLAT is not invariant or footprint latitude. The interface labels the centered-dipole convention explicitly. See [NASA's coordinate definitions](https://sscweb.gsfc.nasa.gov/users_guide/Appendix_C.shtml).

The client sends a `POST /locations` XML request selecting SM `Lat` and `Local_Time`, and `DipoleLValue=true`, with `ResolutionFactor=1`. Values come directly from the NASA response; the browser neither runs a magnetic-field model nor substitutes radial distance for L. Magnetic records must match the **actual plotted sample UTC exactly**, including when the nearest-sample option is enabled. The magnetic UTC appears in each card. Missing epochs, fill/invalid fields, and network failures show unavailable values, without interpolation or carry-forward. **Refresh magnetic data** retries the NASA request.

The bundled magnetic responses cover March 16–18, 2015, including the March 19 midnight endpoint. Other dates load on demand in daily requests, with a 48-day in-memory cache. These requests support browser CORS on GitHub Pages. To extend local coverage:

```sh
python tools/download_magnetic.py --start 2017-09-07 --end 2017-09-10
```

The start is inclusive and the end exclusive. Raw responses, exact XML requests, retrieval times, and SHA-256 checksums are saved under `data/magnetic/`; reload the app afterward. Completed files are reused; `--refresh` downloads them again. The spacecraft Import/Export controls do not include this separate magnetic dataset.

## AE and Dst geomagnetic panels

The **Geomagnetic Context** plots follow the same selected UTC time, timeline, and playback controls as the spacecraft. AE and Dst are shown in two aligned plots spanning the selected UTC day, with time on the horizontal axis and nT on the vertical axis. The mint cursor follows the selected time, while compact readouts retain the exact measurement, source timestamp, and quality information.

Hover over a plot to inspect a measured bin and its original UTC timestamp. Click to move the spacecraft time to that UTC minute. With a plot focused, use Left/Right to move one minute, or Shift+Left/Right for one hour. Selecting a different day automatically loads and redraws that day's plots. The plot range is the selected UTC day, independent of the playback interval and trajectory window.

Both traces show the native averaging bins as steps: one minute for AE and one hour for Dst. No smoothing, temporal interpolation, or downsampling is applied. The hourly Dst step occupies its actual hour, with the original midpoint timestamp preserved in the inspection readout. Missing/invalid bins appear as empty, shaded gaps without a connecting line. Each vertical scale is fitted to that day's valid values and includes zero. Loading or retrieval failure clears the previous day's trace immediately.

These are ground-derived, global indices from WDC for Geomagnetism, Kyoto, distributed by NASA OMNI through the CDAWeb HAPI service. They are not local measurements aboard the probes and remain available independently of spacecraft operation or ephemeris gaps. No solar-wind propagation time shift is applied to the indices.

| Index | NASA dataset / parameter | Native timestamp | Selected measurement |
|---|---|---|---|
| AE, nT | `OMNI_HRO_1MIN` / `AE_INDEX` | Start of the one-minute bin | The minute containing the selected time. |
| Dst, nT | `OMNI2_H0_MRG1HR` / `DST1800` | Midpoint of the one-hour bin | The hour containing the selected time. |

For example, at **12:59:59 UTC**, AE uses the 12:59:00 source record and Dst uses the **12:30:00** source record representing **[12:00:00, 13:00:00)**. At 13:00:00, Dst switches to the source record tagged 13:30:00 for [13:00:00, 14:00:00). The bracket notation includes the start and excludes the end. A midpoint timestamp does not turn an hourly index into an instantaneous measurement. The panels show both the actual source timestamp and its corresponding interval.

Values are displayed in integer nT. There is **no interpolation, nearest-bin substitution, or carry-forward across missing bins**. The spacecraft's optional nearest-sample checkbox does not affect the indices. A source fill value (`99999`), an absent record, an invalid record, and a retrieval failure all show no numerical value, with different status messages. **Refresh indices** retries failed retrievals; changing time clears stale values immediately.

For the 2012–2019 mission period, NASA's current availability documentation classifies **AE as provisional** and **Dst as final**. These labels describe the archive period, not a per-record quality flag; the panels say so explicitly. The older HAPI Dst description omits the final status of 2015–2020, so the status label follows NASA's current OMNI availability table. Original HAPI metadata and the documentation links/date are retained in `data/indices/`. Source links in each card open the actual NASA query; their tooltips identify the dataset and retrieval time.

Bundled index data cover **2015-03-16 00:00 UTC ≤ time < 2015-03-19 00:00 UTC**: 4,320 minute AE records and 72 hourly Dst records. Other dates load as one-day requests per index, cached in memory for up to 48 days. The app keeps missing data distinct from network errors.

To obtain more offline index data, run:

```sh
python tools/download_indices.py --start 2017-09-07 --end 2017-09-10
```

Here `--start` is inclusive and **`--end` is exclusive**, using UTC dates. The downloader saves raw NASA responses, parameter metadata, source URLs, retrieval timestamps, and SHA-256 hashes in `data/indices/`; reload the browser afterward. Options include `--indices ae` or `--indices dst`, `--output PATH`, and `--refresh`. Requests are bounded and resumable. Newly downloaded overlapping chunks take precedence over the original example. The existing Import/Export buttons handle spacecraft ephemerides; index files are discovered through their own manifest.

Index sources and conventions:

- [NASA CDAWeb HAPI API](https://cdaweb.gsfc.nasa.gov/hapi)
- [CDAWeb OMNI timing conventions](https://cdaweb.gsfc.nasa.gov/misc/NotesO.html)
- [High-resolution OMNI documentation and AE availability](https://omniweb.gsfc.nasa.gov/html/omni_min_data.html)
- [Hourly OMNI documentation and Dst availability](https://omniweb.gsfc.nasa.gov/html/ow_data.html)

## Source and coordinate processing

1. Request SSCWeb spacecraft IDs **`rbspa,rbspb`** with `resolutionFactor=1`. The separately listed predictive products `rbspapred` and `rbspbpred` are excluded. NASA identifies the definitive source as SPICE files from Johns Hopkins APL.
2. SSCWeb supplies timestamps and Cartesian coordinates in the requested **GSE, GSM or GEO** frame. Its service performs the frame conversion. The browser does not rotate one frame into another with an approximation.
3. Decode SSCWeb’s Java type wrappers, parse offset-bearing timestamps as UTC instants, validate coordinate arrays, reject fill/non-finite values, and sort/deduplicate by timestamp. Original source JSON is retained.
4. Divide returned kilometers by **6,378.16 km/R_E**, SSCWeb’s documented Earth-radius convention. Compute radius as `Math.hypot(x, y, z)`; this is distance from Earth’s center, not altitude or L-shell.
5. Pass those same right-handed X/Y/Z values directly to Three.js; Earth’s reference radius is exactly 1 R_E.

| Frame | Meaning |
|---|---|
| GSE | Geocentric Solar Ecliptic: +X toward Sun, +Z ecliptic north; +Y completes the right-handed frame. |
| GSM | Geocentric Solar Magnetospheric: +X toward Sun; Earth’s dipole lies in the XZ plane; +Z has the northern dipole sense. |
| GEO | Geographic, Earth-fixed: +X equator/Greenwich, +Z geographic north, +Y equator/90° east. |

The sphere’s grid is a **reference grid in the selected frame**, not geographic latitude/longitude in GSE/GSM. Lighting is illustrative; day/night and Earth’s tilt are not modeled. Markers are enlarged for visibility. Reference rings are at 2, 4 and 6 R_E in the XY plane. GSE/GSM histories use the frame at each source time, not one inertially frozen basis. No radiation belts are drawn or inferred.

## Mission availability

The mission date selector spans August 30, 2012 through October 18, 2019. Saved SSCWeb metadata, retrieved October 23, 2026, give these definitive ephemeris limits:

| Probe | First archived timestamp (UTC) | Last archived timestamp (UTC) | Operations ended |
|---|---|---|---|
| A | 2012-08-30 09:25:59 | 2019-10-18 01:00:00 | October 18, 2019 (date precision) |
| B | 2012-08-30 09:25:59 | 2019-07-19 01:00:00 | July 19, 2019, 17:27 UTC |

An interval inside those limits can still contain missing records. **Archive coverage and operational status are different.** The app reports before/after archive coverage separately from a missing sample and does not display post-coverage positions. A failed HTTP request is reported as retrieval failure, not proof that NASA has no data.

## Download additional data for offline use

The Python downloader uses only the standard library, issues sequential requests of at most one day, retains the original response bytes and source URL, and records retrieval time and SHA-256. Completed chunks are reusable when a download is interrupted.

From the application directory:

```sh
python tools/download_ephemeris.py --start 2017-09-07 --end 2017-09-09
```

This extends `data/manifest.json`. Reload the app and select a covered time. The end is inclusive; a bare date means midnight UTC. Download enough margin for the trajectory window (and up to three hours of playback buffer) if you want to avoid online requests at its edges.

To save just one frame and a portable import bundle:

```sh
python tools/download_ephemeris.py --start 2019-07-18T00:00:00Z --end 2019-07-20T00:00:00Z --frames gse --bundle july-2019.json
```

Choose **Import data** and select `july-2019.json`, or reload to use the files already saved in `data/`. Use `--output PATH` for a separate directory and `--refresh` to replace already-cached downloads. Broad intervals can take considerable time/storage; download the dates you need. Keep public-service requests sequential.

The equivalent REST request is:

```text
GET https://sscweb.gsfc.nasa.gov/WS/sscr/2/locations/rbspa,rbspb/20150317T000000Z,20150318T000000Z/gse/?resolutionFactor=1
Accept: application/json
```

The service permits cross-origin browser access. If your network blocks NASA or a request times out, use **Refresh**, download data on an internet-connected machine and import it, or use the included March 2015 interval. No proxy or server-side credential is needed.

## Files and dependencies

```text
index.html                     Interface and methodology dialog
styles.css                     Responsive layout and styling
js/app.js                      UTC controls, playback, UI state, provenance
js/ephemeris.js                 Retrieval, parsing, validation, sample selection
js/scene.js                     Three.js rendering only
js/indices.js                   Native OMNI index retrieval and interval lookup
js/index-panels.js              Index display and independent loading state
js/index-plot.js                SVG time-series plots and UTC interaction
js/magnetic.js                  SSCWeb magnetic-data retrieval and validation
js/magnetic-panels.js           L/MLT/MLAT display matched to plotted sample UTC
vendor/three.module.js          Three.js 0.170.0 (included)
vendor/OrbitControls.js         Matching controls; import changed to local module
vendor/THREE-LICENSE.txt        Three.js MIT license
data/manifest.json             Local chunk index with source URLs and checksums
data/observatories.json         Saved A/B metadata
data/ssc-20150316-20150319.json  Authentic unmodified SSCWeb response
data/indices/                   Raw AE/Dst samples, metadata and provenance
data/magnetic/                  Raw L/MLT/MLAT responses, XML requests and provenance
tools/serve.mjs                 Localhost-only static server, Node built-ins
tools/download_ephemeris.py    Optional offline-data downloader
tools/download_indices.py      Optional offline AE/Dst downloader
tools/download_magnetic.py     Optional offline L/MLT/MLAT downloader
tests/ephemeris.test.mjs        Data-integrity checks using the real fixture
tests/controller.test.mjs       Playback and stale-request regression checks
tests/indices.test.mjs          Native index epochs, bins, fill values and caching
tests/index-panels.test.mjs     Timestamp display and concurrent-selection checks
tests/index-plot.test.mjs       Native-bin geometry, gaps, UTC axes and interaction
tests/magnetic.test.mjs         Authentic magnetic values, source hashes and retrieval
tests/magnetic-panels.test.mjs  Position/magnetic sample alignment and gap handling
```

Three.js and OrbitControls were obtained from the public `three@0.170.0` package via jsDelivr and are bundled with their license. No runtime CDN, font service, image service, analytics, or framework dependency is used. Uncached ephemerides and indices require a network request to NASA SSCWeb or CDAWeb. Live ephemerides are cached in memory (up to 48 daily chunks); Export preserves them across sessions. Metadata limits are deliberately pinned to the accompanying snapshot rather than silently adopting new mission coverage.

Run the integrity checks with:

```sh
npm test
```

They check source fixture hashes, exact component conversion, timestamps, coordinate frames, radial consistency across frames, missing/null records, gap boundaries, nearest-sample restrictions, partial imports, source export/import, offline failures, stale responses, playback timing, AE minute selection, Dst midpoint/interval boundaries, fill flags, and independent index-panel updates.

## Authoritative references

- [NASA SSCWeb REST API](https://sscweb.gsfc.nasa.gov/WebServices/REST/) and [JSON representation](https://sscweb.gsfc.nasa.gov/WebServices/REST/json/)
- [SSCWeb ephemeris provenance](https://sscweb.gsfc.nasa.gov/sscweb_data_provenance.html)
- [SSCWeb user guide, sampling and Earth-radius convention](https://sscweb.gsfc.nasa.gov/users_guide/New_Users_Guide.html)
- [SSCWeb coordinate definitions](https://sscweb.gsfc.nasa.gov/users_guide/Appendix_C.shtml)
- [Live observatory metadata](https://sscweb.gsfc.nasa.gov/WS/sscr/2/observatories)
- [NASA: Probe B ceases operations](https://www.nasa.gov/solar-system/first-of-two-van-allen-probes-spacecraft-ceases-operations/)
- [NASA: mission completion](https://www.nasa.gov/solar-system/ten-highlights-from-nasas-van-allen-probes-mission/)

This is an independent viewer, not an official NASA application.
