# NOAA port sensor + USGS terrain: internal qualification

This extends the existing source registry and observation-quality work. It is
one bounded, real network capture → ESM local retention/reinspection → GSC
representation → GSV internal-review path. It is **not a canonical release**.
The existing ESM fixture projection endpoint remains fixture-only.

## Scope and exact sources

- NOAA CO-OPS station 9414290, San Francisco: `water_level`, `date=recent`,
  `datum=NAVD`, `units=metric`, `time_zone=gmt`. Raw station and observation JSON
  are retained before normalization. Source publication time is unknown.
- USGS 3DEP ImageServer: bbox [-122.55,37.72,-122.35,37.92], 129×129, F32 TIFF,
  horizontal EPSG:4269, no rendering function, nearest resampling. The CONUS
  product's vertical datum is NAVD88. Datum basis is documentation, not an
  invented ellipsoidal transformation. Acquisition/survey date is unknown.
- The two entries are in `src/lib/economy/sourceRegistry.ts`. `adapter` refers
  to the bounded CLI capture, not a newly installed economy live-adapter loop.
  Operational redistribution remains internal-only in this qualification.

Official references: https://api.tidesandcurrents.noaa.gov/api/prod/ and
https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html ;
https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer ;
https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model .

NOAA's first preliminary flag is an outlier **count**; for verified readings it
is an inferred-value flag. The sigma field describes 1-second input samples,
not total measurement uncertainty. Quality and raw flags are retained, and
missing numbers do not become zeros. The viewer's 18-minute freshness threshold
is an explicit display policy, not a service-level guarantee.

## Run the actual chain

With GSC, the private ESM repository, and GSV checked out to the corresponding
industrial-review branches, install their locked Node dependencies. Python
capture uses rasterio 1.4.3 and NumPy 2.2.6 in the qualification workflow.

```sh
# GSC: create a new evidence directory. No default or automatic capture.
python scripts/industrial/capture.py --capture-live --output /work/capture-001
python scripts/industrial/verify_terrain.py /work/capture-001 --output /work/terrain-check-001.json

# ESM: use its existing LocalEvidenceIntake; no ESM source is copied into GSC.
npx esbuild scripts/industrial-review.entry.ts --bundle --platform=node --format=esm --outfile=.stamp/industrial-review.mjs
node .stamp/industrial-review.mjs /work/capture-001 /work/esm-intake /work/esm-review-001.json --allow-internal-qualification

# GSC: supply the ESM reinspection record separately from source bytes.
npx tsx scripts/industrial/compile.ts /work/capture-001 /work/esm-review-001.json /work/view-001 --internal-review-only

# GSV: operator installs the exact local review, never arbitrary provider URLs.
mkdir .industrial-data
cp /work/view-001/* .industrial-data/
npm run build:industrial
python -m http.server 8000 --bind 127.0.0.1 --directory dist-industrial
```

Open `/industrial.html` on that loopback server. A new capture uses a new
output directory. No daemon, scheduler or public operational endpoint is
installed. A retained snapshot ages normally; opening it later never makes it
live again. Default GSV/scene/homepage builds do not load these artifacts.

## Evidence and geometry boundaries

Capture pins raw bytes, exact URLs, request/retrieval times and HTTP headers.
HTTP Date is not relabelled source publication time. The TIFF decoder retains
nodata as null, checks affine/shape/CRS, and records its library/GDAL version.
Reinspection re-decodes every raster sample; a changed decoder is reported.

ESM uses its existing internal INGEST/DERIVE/RETRIEVE policy and retained-byte
store. Its output is an operator-declared local integrity report, not a signed
release, source authentication, independent verification or canonical admission.
The GSC compiler checks the report's checksum and exact capture/source bindings.
Those checks cannot authenticate a forged local report; trusted operator
selection of the ESM process output is required.

GSV receives a digest-named, closed transfer envelope with separate measurement,
retrieval and compilation times. Only loopback source review is enabled. The
mesh maps real NAVD88 samples onto the existing spherical display at 1× scale;
this is not conversion to WGS84 ellipsoidal height. Missing cells have no
triangles. NOAA's station horizontal datum is undeclared, so its marker is
approximate and its display altitude is not a measurement. No flood, bathymetry,
clearance, navigation or precise station/terrain comparison is performed.

The release path remains blocked until actual source-clock, rights, admission,
and release requirements are met. No viewer label, public URL, checksum, source
registry entry or successful HTTP request supplies that authority.

## Tests

`industrialReview.test.ts` covers byte/ESM binding, timestamp order, missingness,
NOAA flags, datum/units, exact source query, raster shape/affine and nodata.
`test_capture.py` generates test rasters; it does not masquerade as live evidence.
Live source captures and internal recomputation reports are separate CI artifacts.
Source readback, ESM reinspection, normalization, browser rendering and full
repository checks retain separate execution identities and outcomes.
