"""Explicit, one-shot acquisition. Source bytes are candidates, never a release.

python scripts/industrial/capture.py --capture-live --output /path/to/new-capture
The only network destinations and query scope are declared below. No credentials.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import platform
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

NOAA = 'https://api.tidesandcurrents.noaa.gov'
USGS = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'
STATION = '9414290'
BBOX = [-122.55, 37.72, -122.35, 37.92]
SIZE = 129
MAX_BYTES = 8 * 1024 * 1024

def instant() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def digest(data: bytes) -> str:
    return 'sha256:' + hashlib.sha256(data).hexdigest()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('REDIRECT_REFUSED')

def acquire(url: str, path: Path, source_id: str) -> dict:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in {'api.tidesandcurrents.noaa.gov', 'elevation.nationalmap.gov'}:
        raise ValueError('SOURCE_NOT_ALLOWLISTED')
    requested = instant()
    request = urllib.request.Request(url, headers={'User-Agent': 'NotationSystems-IndustrialQualification/1.0', 'Accept-Encoding': 'identity'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
        if response.status != 200:
            raise ValueError('SOURCE_HTTP_FAILURE')
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError('SOURCE_SIZE_LIMIT')
        headers = {k: response.headers.get(k) for k in ['Content-Type', 'Date', 'Last-Modified', 'ETag']}
    received = instant()
    with path.open('xb') as stream:
        stream.write(data)
    if digest(path.read_bytes()) != digest(data):
        raise ValueError('CAPTURE_READBACK_FAILED')
    return {'file': path.name, 'sourceId': source_id, 'url': url, 'requestedAt': requested,
            'retrievedAt': received, 'sha256': digest(data), 'bytes': len(data), 'responseHeaders': headers,
            'sourcePublishedAt': None, 'acquisitionKind': 'LIVE_CAPTURE'}

def decode_terrain(path: Path, artifact: dict) -> dict:
    import numpy as np
    import rasterio
    with rasterio.open(path) as raster:
        if raster.count != 1 or raster.width != SIZE or raster.height != SIZE or raster.crs.to_epsg() != 4269:
            raise ValueError('TERRAIN_GRID_OR_CRS_MISMATCH')
        if raster.dtypes != ('float32',):
            raise ValueError('TERRAIN_NOT_FLOAT32')
        affine = raster.transform
        if affine.a <= 0 or affine.e >= 0 or affine.b != 0 or affine.d != 0:
            raise ValueError('TERRAIN_GRID_ROTATION_UNSUPPORTED')
        bounds = list(raster.bounds)
        if any(abs(a-b) > 0.01 for a,b in zip(bounds, BBOX)):
            raise ValueError('TERRAIN_EXTENT_MISMATCH')
        data = raster.read(1, masked=True)
        valid = ~np.ma.getmaskarray(data) & np.isfinite(data.data)
        if not valid.any() or ((data.data[valid] < -500) | (data.data[valid] > 9000)).any():
            raise ValueError('TERRAIN_VALUES_INVALID')
        heights = [float(x) if ok else None for x,ok in zip(data.data.flat, valid.flat)]
        return {'schema': 'gsc.terrain-grid.v1', 'width': SIZE, 'height': SIZE,
                'affine': [affine.a, affine.b, affine.c, affine.d, affine.e, affine.f],
                'bounds': bounds, 'horizontalCrs': 'EPSG:4269', 'axisOrder': 'longitude-latitude',
                'verticalDatum': 'NAVD88', 'verticalDatumBasis': 'USGS 3DEP CONUS product documentation',
                'units': 'm', 'pixelInterpretation': 'area-center', 'rowOrder': 'north-to-south',
                'resampling': 'provider-nearest', 'surveyedAt': None,
                'sourceArtifact': artifact['sha256'], 'heights': heights,
                'missingCells': int((~valid).sum()), 'minimumM': float(data.data[valid].min()),
                'maximumM': float(data.data[valid].max()),
                'decoder': {'library': 'rasterio', 'version': rasterio.__version__, 'gdal': rasterio.__gdal_version__}}

def capture(output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=False)
    artifacts = []
    requests = [
        ('station.json', NOAA + f'/mdapi/prod/webapi/stations/{STATION}.json', 'noaa-coops'),
        ('water-level.json', NOAA + '/api/prod/datagetter?' + urllib.parse.urlencode({
            'date': 'recent', 'station': STATION, 'product': 'water_level', 'datum': 'NAVD',
            'time_zone': 'gmt', 'units': 'metric', 'application': 'NotationSystemsQualification', 'format': 'json'}), 'noaa-coops'),
        ('terrain-service.json', USGS + '?f=pjson', 'usgs-3dep'),
        ('terrain.tif', USGS + '/exportImage?' + urllib.parse.urlencode({
            'bbox': ','.join(map(str, BBOX)), 'bboxSR': '4269', 'imageSR': '4269', 'size': f'{SIZE},{SIZE}',
            'format': 'tiff', 'pixelType': 'F32', 'noData': '-999999',
            'renderingRule': json.dumps({'rasterFunction': 'None'}), 'interpolation': 'RSP_NearestNeighbor',
            'adjustAspectRatio': 'false', 'f': 'image'}), 'usgs-3dep')]
    try:
        for name, url, source in requests:
            artifacts.append(acquire(url, output / name, source))
        grid = decode_terrain(output / 'terrain.tif', artifacts[-1])
        encoded = json.dumps(grid, allow_nan=False, separators=(',', ':')).encode()
        (output / 'terrain-grid.json').write_bytes(encoded)
        manifest = {'schema': 'gsc.industrial-capture.v1', 'capturedAt': instant(), 'stationId': STATION,
                    'status': 'CAPTURED_UNADMITTED', 'canonicalAdmission': False, 'release': None,
                    'artifacts': artifacts, 'derived': {'file': 'terrain-grid.json', 'sha256': digest(encoded),
                    'bytes': len(encoded), 'sourceArtifact': artifacts[-1]['sha256']},
                    'runtime': {'python': platform.python_version()}}
        (output / 'capture.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        return manifest
    except Exception:
        (output / 'failure.json').write_text(json.dumps({'status': 'CAPTURE_FAILED', 'retainedArtifacts': artifacts,
                                                       'canonicalAdmission': False}), encoding='utf-8')
        raise

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture-live', action='store_true', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = capture(args.output)
    print(json.dumps({'status': result['status'], 'artifacts': len(result['artifacts']), 'output': str(args.output)}))
