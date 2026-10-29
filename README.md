# Van Allen Mission Explorer

A browser-based HTML/CSS/JavaScript application for the **definitive NASA SSCWeb ephemerides** of Van Allen Probe A (`rbspa`) and Probe B (`rbspb`). Includes interactive Three.js navigation, UTC time selection, mission/interval timelines, playback, configurable trajectory windows, GSE/GSM/GEO coordinates, per-probe availability, source-data import/export, measured **AE/SYM-H geomagnetic index panels**, and per-probe **electron plasma conditions**.

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
- Each probe also shows **L, MLT, and MLAT** directly below the orbital-view heading and in its inspector card, matched to its plotted position sample. The cyan Probe A and amber Probe B labels update with time selection and playback; missing values display an em dash. The magnetic values use SSCWeb's centered-dipole/SM convention regardless of the Cartesian frame selected for the 3D view.
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

## AE and SYM-H geomagnetic panels

The **Geomagnetic Context** plots follow the same selected UTC time, timeline, and playback controls as the spacecraft. AE and SYM-H are shown in two aligned plots spanning the selected UTC day, with time on the horizontal axis and nT on the vertical axis. The mint cursor follows the selected time, while compact readouts retain the exact measurement, source timestamp, and quality information.

Hover over a plot to inspect a measured bin and its original UTC timestamp. Click to move the spacecraft time to that UTC minute. With a plot focused, use Left/Right to move one minute, or Shift+Left/Right for one hour. Selecting a different day automatically loads and redraws that day's plots. The plot range is the selected UTC day, independent of the playback interval and trajectory window.

Both traces show native one-minute bins as steps. No smoothing, temporal interpolation, or downsampling is applied. Each step occupies its source minute, with the original minute-start timestamp preserved in the inspection readout. Missing/invalid bins appear as empty, shaded gaps without a connecting line. Each vertical scale is fitted to that day's valid values and includes zero. Loading or retrieval failure clears the previous day's trace immediately.

These are ground-derived, global indices from WDC for Geomagnetism, Kyoto, distributed by NASA OMNI through the CDAWeb HAPI service. They are not local measurements aboard the probes and remain available independently of spacecraft operation or ephemeris gaps. No solar-wind propagation time shift is applied to the indices.

| Index | NASA dataset / parameter | Native timestamp | Selected measurement |
|---|---|---|---|
| AE, nT | `OMNI_HRO_1MIN` / `AE_INDEX` | Start of the one-minute bin | The minute containing the selected time. |
| SYM-H, nT | `OMNI_HRO_1MIN` / `SYM_H` | Start of the one-minute bin | The minute containing the selected time. |

For example, at **12:59:59 UTC**, both indices use their **12:59:00** source records representing **[12:59:00, 13:00:00)**. At 13:00:00, both switch to the source records tagged 13:00:00. The bracket notation includes the start and excludes the end. The panels show both the actual source timestamp and its corresponding interval.

**SYM-H replaces the hourly Dst display starting with v1.4.0.** Standard Kyoto Dst is hourly. SYM-H is a related one-minute symmetric horizontal disturbance index, derived using a different station set and a slightly different coordinate system. The app retrieves actual SYM-H measurements; it does not convert or resample hourly Dst.

Values are displayed in integer nT. There is **no interpolation, nearest-bin substitution, or carry-forward across missing bins**. The spacecraft's optional nearest-sample checkbox does not affect the indices. A source fill value (`99999`), an absent record, an invalid record, and a retrieval failure all show no numerical value, with different status messages. **Refresh indices** retries failed retrievals; changing time clears stale values immediately.

For the 2012–2019 mission period, NASA's high-resolution OMNI availability documentation classifies **both AE and SYM-H as provisional**. These labels describe the archive period, not a per-record quality flag; the panels say so explicitly. Original HAPI metadata and the documentation links/date are retained in `data/indices/`. Source links in each card open the actual NASA query; their tooltips identify the dataset and retrieval time.

Bundled index data cover **2015-03-16 00:00 UTC ≤ time < 2015-03-19 00:00 UTC**: 4,320 one-minute records for each of AE and SYM-H. Other dates load as one-day requests per index, cached in memory for up to 48 days. The app keeps missing data distinct from network errors.

To obtain more offline index data, run:

```sh
python tools/download_indices.py --start 2017-09-07 --end 2017-09-10
```

Here `--start` is inclusive and **`--end` is exclusive**, using UTC dates. The downloader saves raw NASA responses, parameter metadata, source URLs, retrieval timestamps, and SHA-256 hashes in `data/indices/`; reload the browser afterward. Options include `--indices ae` or `--indices symh`, `--output PATH`, and `--refresh`. Requests are bounded and resumable. Newly downloaded overlapping chunks take precedence over the original example. The existing Import/Export buttons handle spacecraft ephemerides; index files are discovered through their own manifest.

Index sources and conventions:

- [NASA CDAWeb HAPI API](https://cdaweb.gsfc.nasa.gov/hapi)
- [CDAWeb OMNI timing conventions](https://cdaweb.gsfc.nasa.gov/misc/NotesO.html)
- [High-resolution OMNI documentation and AE/SYM-H availability](https://omniweb.gsfc.nasa.gov/html/omni_min_data.html)
- [Kyoto SYM-H definition and its distinction from hourly Dst](https://wdc.kugi.kyoto-u.ac.jp/aeasy/asy.pdf)

## Local electron plasma conditions

Four stacked **Local Electron Plasma** plots show electron density in cm⁻³, archived f_pe/f_ce, electron temperature anisotropy T⊥/T∥, and scalar electron beta. Each plot overlays **Probe A in cyan** and **Probe B in amber**, with UTC time horizontally and the quantity's value vertically. Both probes share the same vertical scale for direct comparison; the linear scale includes zero, and small beta values use scientific notation.

The plots span **00:00–24:00 on the selected UTC day**, matching the AE/SYM-H plots. The mint cursor follows selected UTC and playback, independently of ephemeris availability. Hover inspects real source samples for both probes; click chooses the nearest UTC minute and pauses playback through the common time controls. Arrow keys move one minute, Shift+Arrow one hour, and Home/End the first/last minute of the day. Changing days loads the corresponding daily history. Compact selected-value readouts and source times remain under each plot; source query links are in **Measurement sources**. **Refresh plasma** retries retrievals.

Every plotted point retains its native instrument epoch: EMFISIS L4 epochs for density and frequency ratio, and HOPE electron epochs for anisotropy and beta. The original values and quality checks are reused without resampling, averaging, smoothing, or downsampling. Lines only provide visual connections between consecutive valid native records within the documented gap limits below. Fill values, rejected flags, missing records, or a source failure break the trace; one probe's failure does not remove the other's data. Isolated valid samples remain visible as points. Selected and hover markers sit at the actual matched source epoch, while the vertical cursor stays at the requested UTC; no numerical value is read from an interpolated line. Beta inspection also shows the separate measured-field epoch.

Daily series and geometry are reused while the selected cursor moves, so playback does not repeatedly derive or redraw the complete history.

| Quantity | Data and definition |
|---|---|
| Electron density n_e | Native EMFISIS L4 `density`, total electron density inferred from wave observations. |
| f_pe/f_ce | Native EMFISIS L4 `wpe_over_wce`. Angular-frequency and ordinary-frequency ratios are identical; the archived value is displayed directly. |
| Electron anisotropy | `Tperp_e_200 / Tpar_e_200` from the same HOPE electron-moment record. Isotropy is 1; this is not the alternative ratio-minus-one convention. |
| Scalar β_e | `2 μ0 n_HOPE e (Tpar + 2 Tperp) / (3 B²)`, using the same HOPE record's partial density and temperatures, and measured EMFISIS magnetic magnitude matched to the HOPE epoch. |

**The HOPE anisotropy and beta describe a partial electron population ≥200 eV, in apogee mode, up to the instrument's approximately 50 keV upper range.** They are not total-plasma or ion beta. HOPE partial moments are not corrected for spacecraft potential. The calculation uses HOPE density with HOPE temperatures; total EMFISIS density is not substituted into the hot-electron pressure. Temperatures are in eV, density converts from cm⁻³ to m⁻³, and magnetic magnitude from nT to T. Derived quantities are identified as such; spacecraft magnetic model fields are never used for beta.

The native NASA CDAWeb HAPI sources are:

| Product | Probe A dataset | Probe B dataset | Parameters |
|---|---|---|---|
| EMFISIS L4 density | `RBSP-A_DENSITY_EMFISIS-L4` | `RBSP-B_DENSITY_EMFISIS-L4` | `density`, `wpe_over_wce` (with native `bmag`, `fpe`, `fce` retained) |
| HOPE release04 L3 electron moments | `RBSPA_REL04_ECT-HOPE-MOM-L3@1` | `RBSPB_REL04_ECT-HOPE-MOM-L3@1` | `Tpar_e_200`, `Tperp_e_200`, `Dens_e_200`, `e_T_flag`, `e_Tperp_flag`, `e_Dens_flag` |
| EMFISIS L3 measured magnetic field | `RBSP-A_MAGNETOMETER_4SEC-GSE_EMFISIS-L3` | `RBSP-B_MAGNETOMETER_4SEC-GSE_EMFISIS-L3` | `Magnitude`, `calState`, `magInvalid`, `magFill` |

The `@1` HAPI product selects the native electron epochs, rather than the separate ion epochs. HAPI units and parameter names are validated. Nonfinite, nonphysical, and source fill values are rejected. HOPE temperature flags must both be zero for anisotropy; beta additionally requires the density flag to be zero. All three magnetic flags must be zero. EMFISIS L4 does not expose a per-record quality flag through this product; no final/provisional certification is invented.

The instruments have different cadences and often do not sample at an ephemeris minute. The app uses **conservative nearest-native-sample matching, without interpolation**:

- Density / ratio: absolute offset ≤3.5 s, bracket separation ≤7.01 s.
- HOPE: absolute offset ≤12.5 s, bracket separation ≤25 s.
- Magnetic field: absolute offset ≤2.01 s from the selected HOPE epoch, bracket separation ≤4.01 s. Both HOPE and magnetic source UTCs are shown for beta.

An exact source timestamp can be used directly. Otherwise both surrounding source records must exist and satisfy the separation limit; there is no extrapolation. Selection considers all rows before checking values and quality flags, so a missing or flagged nearest sample is never skipped to obtain a more distant good value. These limits are explicit app selection rules, **not claims of native averaging intervals**. The density product has irregular epochs, and the HOPE product does not provide usable integration bounds through HAPI. Gaps remain unavailable even if a wider search would find measurements. Requests include 30 s of padding at each UTC-day edge to apply the same rule across midnight.

Source coverage differs from spacecraft operations and from the other instruments. In particular, the default March17,2015 noon selection contains missing Probe A density and HOPE data; unavailable output there is a real archive limitation. Probe B has usable records near that selection. A failure fetching one product or probe does not erase independent available quantities, and playback never waits on plasma data or changes the selected time.

Raw responses for **March16–18,2015**, with boundary padding, are bundled under `data/plasma/`. Additional dates load on demand in daily requests and are cached in memory for up to 24 days. For offline use:

```sh
python tools/download_plasma.py --start 2017-09-07 --end 2017-09-10
```

The start date is inclusive and the end exclusive. The standard-library downloader saves unmodified NASA responses, parameter metadata, URLs, retrieval UTCs, and SHA-256 hashes. Use `--output PATH` for a separate directory or `--refresh` to retrieve existing files again. Reload after downloading. Plasma uses its own manifest; the spacecraft Import/Export controls do not include these datasets.

Sources: [CDAWeb EMFISIS and HOPE notes](https://cdaweb.gsfc.nasa.gov/misc/NotesR.html), [HOPE electron moment description](https://spase-metadata.org/NASA/NumericalData/RBSP/B/ECT/HOPE/L3/Moments/Release04/PT24.35S), and [NASA CDAWeb HAPI](https://cdaweb.gsfc.nasa.gov/hapi).

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
js/plasma.js                    Plasma retrieval, quality checks, time matching and derivation
js/plasma-panels.js             Synchronized plasma plots, readouts and independent loading
js/plasma-series.js             Native-epoch series with source quality and derived quantities
js/plasma-plot.js               Dual-probe SVG plots, native gaps and UTC interaction
vendor/three.module.js          Three.js 0.170.0 (included)
vendor/OrbitControls.js         Matching controls; import changed to local module
vendor/THREE-LICENSE.txt        Three.js MIT license
data/manifest.json             Local chunk index with source URLs and checksums
data/observatories.json         Saved A/B metadata
data/ssc-20150316-20150319.json  Authentic unmodified SSCWeb response
data/indices/                   Raw AE/SYM-H samples, metadata and provenance
data/magnetic/                  Raw L/MLT/MLAT responses, XML requests and provenance
data/plasma/                    Raw EMFISIS/HOPE responses, metadata and provenance
tools/serve.mjs                 Localhost-only static server, Node built-ins
tools/download_ephemeris.py    Optional offline-data downloader
tools/download_indices.py      Optional offline AE/SYM-H downloader
tools/download_magnetic.py     Optional offline L/MLT/MLAT downloader
tools/download_plasma.py       Optional offline electron-plasma downloader
tests/ephemeris.test.mjs        Data-integrity checks using the real fixture
tests/controller.test.mjs       Playback and stale-request regression checks
tests/indices.test.mjs          Native index epochs, bins, fill values and caching
tests/index-panels.test.mjs     Timestamp display and concurrent-selection checks
tests/index-plot.test.mjs       Native-bin geometry, gaps, UTC axes and interaction
tests/magnetic.test.mjs         Authentic magnetic values, source hashes and retrieval
tests/magnetic-panels.test.mjs  Position/magnetic sample alignment and gap handling
tests/plasma.test.mjs           Real source values, quality, timing and derived physics
tests/plasma-panels.test.mjs    Plasma plot synchronization and stale-request handling
tests/plasma-series.test.mjs    Native series, quality gaps and derived data integrity
tests/plasma-plot.test.mjs      Dual-probe geometry, axes, selection and interaction
```

Three.js and OrbitControls were obtained from the public `three@0.170.0` package via jsDelivr and are bundled with their license. No runtime CDN, font service, image service, analytics, or framework dependency is used. Uncached ephemerides and indices require a network request to NASA SSCWeb or CDAWeb. Live ephemerides are cached in memory (up to 48 daily chunks); Export preserves them across sessions. Metadata limits are deliberately pinned to the accompanying snapshot rather than silently adopting new mission coverage.

Run the integrity checks with:

```sh
npm test
```

They check source fixture hashes, exact component conversion, timestamps, coordinate frames, radial consistency across frames, missing/null records, gap boundaries, nearest-sample restrictions, partial imports, source export/import, offline failures, stale responses, playback timing, AE/SYM-H minute selection and interval boundaries, fill flags, and independent index-panel updates.

## Authoritative references

- [NASA SSCWeb REST API](https://sscweb.gsfc.nasa.gov/WebServices/REST/) and [JSON representation](https://sscweb.gsfc.nasa.gov/WebServices/REST/json/)
- [SSCWeb ephemeris provenance](https://sscweb.gsfc.nasa.gov/sscweb_data_provenance.html)
- [SSCWeb user guide, sampling and Earth-radius convention](https://sscweb.gsfc.nasa.gov/users_guide/New_Users_Guide.html)
- [SSCWeb coordinate definitions](https://sscweb.gsfc.nasa.gov/users_guide/Appendix_C.shtml)
- [Live observatory metadata](https://sscweb.gsfc.nasa.gov/WS/sscr/2/observatories)
- [NASA: Probe B ceases operations](https://www.nasa.gov/solar-system/first-of-two-van-allen-probes-spacecraft-ceases-operations/)
- [NASA: mission completion](https://www.nasa.gov/solar-system/ten-highlights-from-nasas-van-allen-probes-mission/)

This is an independent viewer, not an official NASA application.
