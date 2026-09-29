# GIS / remote-sensing scene inspection

This slice connects **an explicitly requested, bounded USGS Landsat STAC page →
byte-bound acquisition receipt → scene metadata inspection → GeoJSON scene
envelopes → replay**. It extends the industrial observation-quality work; it
neither replaces that validator nor admits candidate records into canonical state.

## Run it

From the repository root, after `npm ci`:

```sh
# Offline synthetic example: no network, explicitly labelled synthetic.
npx tsx scripts/rs-scenes.ts demo rs-demo

# One real metadata request to the fixed official USGS catalog. No imagery download.
npx tsx scripts/rs-scenes.ts discover examples/remote-sensing/query.json rs-live

# Recompute from exact retained bytes. No network; the output is a NEW directory.
npx tsx scripts/rs-scenes.ts replay rs-live rs-replay
```

Existing directories are refused, not overwritten. The example AOI is a broad
southern-Ontario rectangle, not a claim about any facility. The query uses a
fixed July 2025 acquisition interval, explicit longitude/latitude CRS84 and a
scene-cloud threshold. Change the query before discovery; replay reuses the
exact acquisition query, not a silently enlarged AOI or time window.

Each successful directory contains `snapshot.json` (exact response bytes),
`receipt.json`, `query.json`, `inspection.json`, `scene-envelopes.geojson` and
`manifest.json`. The manifest is written last and hashes each preceding file.
A partially written directory is not a completed run. Exact source bytes are
saved before normalization; a whole-page refusal gets a `REFUSED` manifest and
a fixed-code `refusal.json`, not a forged successful inspection. Local output is not
publication or an ESM release. The CLI emits fixed error codes, not raw upstream
error bodies, credentials, input contents or local paths.

## Source eligibility and acquisition

The original `SOURCE_REGISTRY` now contains exactly one additional source:
`usgs-landsat-c2l2-stac`, backed by `landsat-c2l2-stac-metadata.v1`.
It is specifically the official `landsat-c2l2-sr` metadata collection, not a
registration for arbitrary STAC catalogs or a blanket right to collect imagery.
It is not added to the automatically booted commodity acquisition adapters.

`collectLandsatSnapshot()` checks that registry entry and constructs one GET to
`https://landsatlook.usgs.gov/stac-server/search`. The only query fields are the
fixed collection, validated bounding box, time interval and page limit. No caller
URL, provider alias, free-text query or dynamic collection is accepted. Redirects
are refused. JSON media types, a 15-second deadline, maximum 4 MiB streamed body,
and maximum 50 returned items bound the operation. It does not retry, crawl,
follow pagination links, fetch thumbnails or download any raster assets.

Source eligibility follows the fixed public Earth-observation source and the
collection's measurement meaning. Scene metadata is not evidence of a person's
identity, presence, movement, or industrial production. No such inference is
implemented. Unknown source fields, descriptions and asset URLs are not echoed
into the inspection or map output.

USGS documents this catalog and its Landsat data-use policy. Source attribution
is retained. This is not a legal determination about arbitrary third-party
assets, external APIs or later derived products.

## What the inspector actually checks

`inspectSceneSnapshot(bytes, receipt, query, executionRef)` is a server-side,
deterministic metadata operator. It does not initiate network or filesystem I/O.
It accepts a deliberately bounded STAC 1.0.0 / 1.1.0 subset, not every legal STAC
Item or every extension.

- Query CRS is `OGC:CRS84`, with explicit longitude/latitude order. Only 2D,
  non-antimeridian bounding boxes of at most 180 degrees longitude are supported.
  Polygon/MultiPolygon coordinates must be finite, bounded, closed and within
  the reported bbox. This is not a self-intersection/topology proof.
- UTC instants retain one to nine fractional-second digits. Date-only strings,
  invalid dates, leap seconds, local time, offsets and longer fractional seconds
  refuse instead of undergoing an implicit conversion. Acquisition intervals
  use inclusive endpoints; a nominal instant is not given an invented duration.
- Scene-wide `eo:cloud_cover` is a reported percentage, not a probability or an
  AOI cloud measurement. Missing values remain null. With a threshold enabled,
  missing cloud metadata is **undetermined**, not clear or rejected as cloudy.
- STAC 1.0 `eo:bands` and 1.1 asset `bands` retain explicitly supplied spectral
  names. No band number is guessed. Declared GeoTIFF/COG media type and projected
  EPSG reference are metadata only; conflicting EPSG declarations refuse.
  Missing raster CRS remains null, never inferred from the CRS84 footprint.
- Identical duplicate items are counted once and the extra rows are named as
  duplicates. Same-ID items with different parsed JSON content are all refused
  as conflicting versions; no first-writer-wins selection hides a disagreement.
- Selected candidates are sorted by acquisition start, newest first, with an
  explicit scene-ID tie-break. This is a deterministic order, not quality or
  confidence ranking. Every supplied row is selected, filtered with its first
  applicable predicate, rejected with a reason, or held undetermined.

The GeoJSON layer contains **reported bbox envelopes**, not exact footprint
polygons, acquisition footprints reconstructed from telemetry, or raster pixels.
Its predicate is `BBOX_CANDIDATE_ONLY`; a rectangle overlap does not establish
that usable pixels exist in the AOI. No areas or coverage fractions are computed
in angular coordinates. This layer can be inspected with an existing GeoJSON
reader, but it is not automatically published to GSV or the homepage.

## Gaps, identity and evidence

An empty returned page uses the existing `inspectIndustrialObservation()`
validator to represent a `FEED_GAP`, with unknown coverage and collection health.
An all-filtered, malformed or unresolved nonempty page is **not** an empty feed.
The bridge inherits the earlier quality validator's narrower UTC precision:
when a query uses sub-millisecond precision, that bridge can return a typed
`INVALID_TIME` refusal rather than truncating it. The scene report still retains
the original precision and the bridge's refusal.

The response may advertise another page or report a matching total, but catalog
completeness remains `NOT_ESTABLISHED` even without a next link. Absence of a
scene from one page does not establish absence of imagery, an asset or activity.

Artifact ID hashes exact bytes. Evidence occurrence ID separately binds those
bytes to the source, query and retrieval instant. The same bytes acquired twice
can therefore have different evidence IDs. The query is byte-independent but
canonicalized before hashing. Metadata `created` and `updated` are retained as
metadata times, not fabricated publication times. `knownAt` is conservatively
the recorded retrieval time; an earlier knowledge cutoff filters the candidates.

Replays preserve the representation content ID but receive a new execution ID.
The manifest retains the optional operator-supplied `GSC_IMPLEMENTATION_REF`
(CI supplies the exact commit); absence remains null rather than a guessed code
version. The provider operation ID is `gsc.rs-scene-inspect.v1`; verification identity
stays null. A byte hash and an editable receipt are **not a signature, publisher
authentication, acquisition proof, or ESM admission**. Offline replay checks
internal consistency, not external truth. `originVerification` remains explicitly
`NOT_PERFORMED`. Do not accept user-created receipts as trusted evidence merely
because they pass this library's structural checks.

All reports preserve `pixelsRead: 0`, unknown AOI pixel/cloud coverage, unknown
positional accuracy, null confidence, unestablished physical cause, and no
admission/release. GSD is a declared sampling distance, not accuracy.

## Stack placement

NET keeps investigation, operation selection and run history. This supplies a
GSC specialist implementation and local CLI; it does not silently bind NET PR
#64's `spatial.map`, `spatial.inspect`, or `rs.scene.admit` interface targets.
An explicit host adapter must request this operation and retain its results.
PPDA/ESM remain responsible for acquisition/admission/release governance; GSV
remains a read-only consumer of explicitly released projections. PAYLOAD,
TRADEWIND and LANDSHARK are unchanged. The public homepage is unchanged.

No new HTTP route, imagery service, evidence store, credential, dependency or
licensing change is introduced. The standalone read-only scene report is not a
canonical economy Observation. COG reads, masks/QA, reprojection, spatial sampling,
NDVI, change detection, physical calibration and authenticated ESM/NET transport
are not implemented by this metadata slice.

## Validation

The shared case factory is registered with the existing Vitest suite; the same
cases run after strict TypeScript compilation under Node's built-in test runner.
The RS workflow retains exact tracked source and targeted run artifacts, exercises
the actual demo/replay CLI, and makes one explicitly scoped live catalog probe
on pushes to this development branch. Ordinary repository tests remain hermetic.
A failed live probe is not reclassified as a passing integration test. Full
repository CI is separate and must also pass.

```sh
npx vitest run src/lib/remoteSensing/stacScenes.test.ts
npx tsc --noEmit
npm test
npm run build
```

## Primary specification and source references

- [USGS STAC catalog documentation](https://www.usgs.gov/landsat-missions/spatiotemporal-asset-catalog-stac)
- [USGS surface-reflectance collection](https://landsatlook.usgs.gov/stac-server/collections/landsat-c2l2-sr)
- [USGS Landsat use and redistribution statement](https://www.usgs.gov/faqs/are-there-any-restrictions-use-or-redistribution-landsat-data)
- [STAC 1.1.0 Item specification](https://github.com/radiantearth/stac-spec/blob/v1.1.0/item-spec/item-spec.md)
- [STAC 1.1.0 common metadata: inclusive time bounds and metadata timestamps](https://github.com/radiantearth/stac-spec/blob/v1.1.0/commons/common-metadata.md)
- [EO extension: cloud cover is scene-wide and missing is not zero](https://github.com/stac-extensions/eo)
