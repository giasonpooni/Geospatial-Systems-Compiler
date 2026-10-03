"""Re-decode retained GeoTIFF bytes and compare all sample and grid semantics.

This is internal recomputation, not independent field validation or source auth.
"""
from pathlib import Path
import argparse
import json
from capture import decode_terrain, digest

def verify(root: Path) -> dict:
    manifest = json.loads((root / 'capture.json').read_text())
    raw = (root / 'terrain.tif').read_bytes()
    artifact = manifest['artifacts'][3]
    if artifact['sha256'] != digest(raw) or len(raw) != artifact['bytes']:
        raise ValueError('TIFF_BYTES_MISMATCH')
    grid_bytes = (root / 'terrain-grid.json').read_bytes()
    if digest(grid_bytes) != manifest['derived']['sha256']:
        raise ValueError('GRID_BYTES_MISMATCH')
    held = json.loads(grid_bytes)
    recomputed = decode_terrain(root / 'terrain.tif', artifact)
    # Runtime/library identity may differ. Its difference is reported, not hidden.
    fields = set(recomputed) - {'decoder'}
    if set(held) != set(recomputed) or any(held[key] != recomputed[key] for key in fields):
        raise ValueError('GRID_RECOMPUTATION_MISMATCH')
    return {'schema': 'gsc.terrain-recompute.v1', 'result': 'MATCH',
            'sourceDigest': digest(raw), 'gridDigest': digest(grid_bytes),
            'sampleCount': len(held['heights']), 'retainedDecoder': held['decoder'],
            'recomputeDecoder': recomputed['decoder'], 'independentVerification': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.capture)
    with args.output.open('x', encoding='utf8') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps(report))
