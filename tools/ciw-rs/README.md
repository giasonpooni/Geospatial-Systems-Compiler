# Local scene inspection and NDVI specialist

GSC owns this optional raster runtime. NET selects an operation and retains its
run; PPDA/ESM retain lineage and admission authority. Nothing here is wired into
GSC's browser, GSV, the homepage, public routes or a new product domain.

`rs.scene.inspect.v1` inspects an operator-pinned local STAC 1.0.0 Item and two
single-band reflectance GeoTIFFs, plus optional categorical quality GeoTIFF.
`rs.index.ndvi.v1` additionally evaluates one explicit integer pixel window.
Both accept the existing `ciw.adapter-request.v1` subprocess envelope. The source
module is `worker` with import root `tools/ciw-rs`. `rs.runtime.v1` reports the
installed dependency identities only; it does not read a scene.

## Run the synthetic qualification

```sh
python -m pip install -r tools/ciw-rs/requirements.txt
python -m pytest -q tools/ciw-rs/test_worker.py
python tools/ciw-rs/fixture.py --output-dir /tmp/rs-synthetic
```

The fixture creates actual small COG files with artificial values. It is not
Sentinel/Landsat imagery, observed vegetation or an ESM-admitted scene. Its JSON
manifest contains content digests for every selected asset, explicit provenance,
license/collection-policy/radiometry references and red/NIR/quality mappings.
The output `ndvi-request.json` can be dispatched from NET using that scene digest.
Do not place generated outputs in a checkout used as an executable source pin.

## Computation and basis

The worker reads the entire bounded pinned file into a private MemoryFile, then
uses Rasterio/GDAL windows. It accepts only internal GeoTIFF georeferencing and
north-up static WGS84 UTM EPSG:32601–32660 or 32701–32760. Selected bands must have
identical native CRS, shape, affine grid and declared area/point sampling. STAC
projection metadata must agree with actual headers. No reprojection, resampling,
clipping-to-fit, geoid correction or coordinate-epoch transformation occurs.

STAC `raster:bands` must explicitly declare nodata, dtype, sampling, scale, offset
and reflectance unit `1`. The worker applies `DN * scale + offset` before
`(NIR - red) / (NIR + red)`. Nondefault TIFF scale/offset must agree with STAC;
TIFF defaults (1,0) permit the explicitly selected STAC radiometry. Its authority
remains a source declaration, not a calibration certificate.

Nodata in either band, optional declared categorical quality exclusions,
nonfinite inputs, exactly zero denominators and nonfinite results have separate
nonoverlapping counts. Missing pixels and all-missing summaries stay null. No
NDVI clipping is performed; out-of-[-1,1] results are counted, not hidden. No
vegetation-health class, occupancy, person yield, confidence or covariance is
inferred. A quality-code policy is operator evidence, not automatic cloud mapping.
The Item's cloud percentage is scene-level metadata, never local cloud fraction.

The STAC footprint is retained as declared CRS84 metadata, separate from the
native raster grid. The requested integer window has computed native bounds,
but its external AOI reference is an operator association, not a polygon
intersection or proof that the declared footprint matches those pixels.

## Inputs, rights and limits

Only explicitly mapped local assets are read; STAC hrefs and collection links are
never followed. Non-TIFF inputs, URI/VSI paths, path traversal, symlinks and known
external sidecars refuse. External .msk/.ovr/.aux.xml/.tfw inputs are not silently
used or dropped. This does not sandbox arbitrary hostile native-library input.

Bounds: 256 KiB metadata per file, 32 MiB per selected raster, at most three
rasters, 4,096 window pixels, 40,000 pixels per scene axis, and at most 1,048,576
pixels per storage block. This full-file byte-pinning pilot is not HTTP COG range
access or large-scene streaming. COG layout markers are reported, not certified.

`source` in the pinned manifest is operator-provided provenance: source identity,
knownAt, lineage, license posture/reference, collection policy and radiometry.
It is separate from the STAC acquisition instant/interval. Declared person,
mixed or unknown yield refuses before asset parsing. A declaration and a hash
cannot authenticate rights, classify unseen content or prove complete ancestry;
operator/PPDA source review remains required. Manifest fields are not a second
source registry. Only infrastructure/land-cover candidate computations belong
here; admission and release stay `not_performed` and verification remains null.

The output includes an independent specialist execution ID, worker/dependency
versions, exact source digests, native grid, selection, coverage and optional
NDVI values/statistics. A reader can validate references without loading this
runtime; physical/numerical qualification is not inferred from resealed JSON.

## Primary references

- STAC Item 1.0.0: https://github.com/radiantearth/stac-spec/blob/v1.0.0/item-spec/item-spec.md
- Raster extension 1.1.0: https://github.com/stac-extensions/raster/blob/v1.1.0/README.md
- Projection extension 1.1.0: https://github.com/stac-extensions/projection/blob/v1.1.0/README.md
- Rasterio masks: https://rasterio.readthedocs.io/en/stable/topics/masks.html
- Rasterio windows: https://rasterio.readthedocs.io/en/stable/topics/windowed-rw.html
- USGS NDVI definition: https://www.usgs.gov/landsat-missions/landsat-normalized-difference-vegetation-index
- GDAL COG driver: https://gdal.org/en/stable/drivers/raster/cog.html
