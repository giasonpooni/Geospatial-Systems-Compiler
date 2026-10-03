"""Write tiny, explicitly synthetic STAC + actual COG fixtures; not satellite data."""
from pathlib import Path
import argparse
import json

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.shutil import copy as copy_raster
from rasterio.transform import from_origin
from worker import byte_ref, digest, encode


def make(destination: Path, *, altered=False, offset=0.0):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    red = np.full((4,4), 1000, dtype='int16')
    nir = np.full((4,4), 3000, dtype='int16')
    nir[0,1] = 1000
    red[0,2] = nir[0,2] = 0
    red[0,3] = -9999
    if altered: nir[0,0] = 1000
    quality = np.full((4,4), 4, dtype='uint8'); quality[1,0] = 9
    transform = from_origin(500000, 4800000, 10, 10)
    rasters = {'B04': red, 'B08': nir, 'SCL': quality}
    assets, pins = {}, {}
    for key, values in rasters.items():
        scale = 1 if key == 'SCL' else 0.0001
        off = 0 if key == 'SCL' else offset
        nodata = 255 if key == 'SCL' else -9999
        with MemoryFile() as mem:
            with mem.open(driver='GTiff',height=4,width=4,count=1,dtype=str(values.dtype),crs='EPSG:32617',
                          transform=transform,nodata=nodata) as ds:
                ds.write(values,1); ds.scales=(scale,); ds.offsets=(off,)
                ds.update_tags(AREA_OR_POINT='Area')
            with mem.open() as ds:
                copy_raster(ds, destination/f'{key}.tif', driver='COG', BLOCKSIZE=128, COMPRESS='DEFLATE', OVERVIEW_COUNT=0)
        raw = (destination/f'{key}.tif').read_bytes()
        pins[key] = {'path':f'{key}.tif','sha256':byte_ref(raw)}
        assets[key] = {'href':f'./{key}.tif','type':'image/tiff; application=geotiff; profile=cloud-optimized',
            'roles':['data'],'raster:bands':[{'data_type':str(values.dtype),'nodata':nodata,'sampling':'area',
                                           'unit':'1','scale':scale,'offset':off}]}
        if key != 'SCL': assets[key]['eo:bands']=[{'common_name':'red' if key=='B04' else 'nir'}]
    item = {'type':'Feature','stac_version':'1.0.0', 'id':'synthetic-rs-alternative' if altered else 'synthetic-rs-baseline',
            'collection':'synthetic-rs-qualification','stac_extensions':[
                'https://stac-extensions.github.io/eo/v1.0.0/schema.json',
                'https://stac-extensions.github.io/raster/v1.1.0/schema.json',
                'https://stac-extensions.github.io/projection/v1.1.0/schema.json'],
            'bbox':[-81,43.35,-80.99,43.36],
            'geometry':{'type':'Polygon','coordinates':[[[-81,43.35],[-80.99,43.35],[-80.99,43.36],[-81,43.36],[-81,43.35]]]},
            'properties':{'datetime':'2026-09-26T12:00:00Z','platform':'synthetic', 'instruments':['synthetic-red-nir'],
                'proj:epsg':32617,'proj:shape':[4,4],'proj:transform':list(transform)[:6], 'eo:cloud_cover':None},
            'links':[{'rel':'collection','href':'./collection.json','type':'application/json'}], 'assets':assets}
    raw = encode(item); (destination/'item.json').write_bytes(raw)
    collection = {'type':'Collection','stac_version':'1.0.0','id':'synthetic-rs-qualification',
      'description':'Artificial numbers and declared footprint for software qualification, not imagery.',
      'license':'other','extent':{'spatial':{'bbox':[item['bbox']]},'temporal':{'interval':[['2026-09-26T12:00:00Z','2026-09-26T12:00:00Z']]}},'links':[]}
    (destination/'collection.json').write_bytes(encode(collection))
    manifest = {'schema':'gsc.rs-scene.v1','source':{'id':'synthetic:demo','knownAt':'2026-09-28T12:00:00Z',
        'license_posture':'synthetic','license_ref':digest('synthetic-only-not-a-distribution-grant'),
        'lineage_refs':[digest('fixture-generator-software-only')], 'collection_policy_ref':digest('synthetic-land-cover'),
        'radiometry_ref':digest('explicit-synthetic-reflectance-values'),'yield_class':'land_cover','product_family':'synthetic_reflectance'},
        'item':{'path':'item.json','sha256':byte_ref(raw)}, 'assets':pins,
        'bands':{'red':'B04','nir':'B08','quality':'SCL'}, 'quality':{'keep_codes':[4,5,6],'policy_ref':digest('fixture-only-keep-codes')},
        'pixel_basis':'area'}
    (destination/'scene.json').write_bytes(encode(manifest))
    request={'investigation_id':'synthetic-yard-cover','room':'LANDSHARK','entity':{'kind':'site','id':'synthetic-site'},
             'aoi_ref':digest('operator-selected-4x4-pixel-window'),'window':[0,0,4,4],'quality':'declared_mask'}
    (destination/'ndvi-request.json').write_bytes(encode({'operation':'rs.index.ndvi.v1','parameters':request}))
    (destination/'inspect-request.json').write_bytes(encode({'operation':'rs.scene.inspect.v1','parameters':request}))
    return manifest, request


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--altered',action='store_true')
    args=p.parse_args();make(args.output_dir,altered=args.altered)
    print(json.dumps({'bundle':str(args.output_dir/'scene.json'), 'sha256':byte_ref((args.output_dir/'scene.json').read_bytes()),'synthetic':True}))
