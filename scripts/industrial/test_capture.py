"""Hermetic raster/transport tests. Generated rasters are not real source data."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from capture import decode_terrain, acquire, NoRedirect, BBOX, SIZE

class RasterContracts(unittest.TestCase):
    def write(self, root, *, width=129, crs='EPSG:4269', dtype='float32', value=10, nodata=-999999):
        file = Path(root) / 'terrain.tif'
        with rasterio.open(file, 'w', driver='GTiff', width=width, height=SIZE, count=1, dtype=dtype,
                           crs=crs, nodata=nodata, transform=from_bounds(*BBOX, width, SIZE)) as dst:
            data = np.full((SIZE, width), value, dtype=dtype)
            dst.write(data, 1)
        return file
    def test_grid_basis_and_count(self):
        with TemporaryDirectory() as root:
            grid = decode_terrain(self.write(root), {'sha256': 'test-only'})
            self.assertEqual(len(grid['heights']), 16641)
            self.assertEqual(grid['minimumM'], 10)
            self.assertEqual(grid['horizontalCrs'], 'EPSG:4269')
            self.assertEqual(grid['verticalDatum'], 'NAVD88')
            self.assertIsNone(grid['surveyedAt'])
    def test_nodata_is_not_zero(self):
        with TemporaryDirectory() as root:
            file = self.write(root)
            with rasterio.open(file, 'r+') as dst:
                a = dst.read(1); a[0, 0] = -999999; dst.write(a, 1)
            grid = decode_terrain(file, {'sha256': 'test-only'})
            self.assertIsNone(grid['heights'][0]); self.assertEqual(grid['missingCells'], 1)
    def test_all_missing_refuses(self):
        with TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError, 'TERRAIN_VALUES_INVALID'):
                decode_terrain(self.write(root, value=-999999), {'sha256': 'test-only'})
    def test_wrong_shape(self):
        with TemporaryDirectory() as root:
            with self.assertRaises(ValueError): decode_terrain(self.write(root, width=128), {'sha256': 'test-only'})
    def test_wrong_crs(self):
        with TemporaryDirectory() as root:
            with self.assertRaises(ValueError): decode_terrain(self.write(root, crs='EPSG:4326'), {'sha256': 'test-only'})
    def test_wrong_dtype(self):
        with TemporaryDirectory() as root:
            with self.assertRaises(ValueError): decode_terrain(self.write(root, dtype='float64'), {'sha256': 'test-only'})
    def test_out_of_range(self):
        with TemporaryDirectory() as root:
            with self.assertRaises(ValueError): decode_terrain(self.write(root, value=10000), {'sha256': 'test-only'})
    def test_forbidden_host_without_network(self):
        with self.assertRaisesRegex(ValueError, 'SOURCE_NOT_ALLOWLISTED'):
            acquire('https://example.invalid/private', Path('/tmp/never-written'), 'other')
    def test_redirect_refused(self):
        with self.assertRaisesRegex(ValueError, 'REDIRECT_REFUSED'):
            NoRedirect().redirect_request(None,None,302,'',{},'https://example.invalid')

if __name__ == '__main__': unittest.main()
