"""Actual local COG IO and specialist math, including independent scalar checks."""
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
import json

import numpy as np
import pytest
import rasterio

from fixture import make
from worker import execute, byte_ref, encode, parse, Refusal, runtime


@pytest.fixture
def scene(tmp_path):
    root=tmp_path/'scene';manifest,request=make(root)
    return root,manifest,request


def write_manifest(root,manifest):
    (root/'scene.json').write_bytes(encode(manifest))


def edit_item(root,manifest,change):
    item=parse((root/'item.json').read_bytes());change(item)
    raw=encode(item);(root/'item.json').write_bytes(raw);manifest['item']['sha256']=byte_ref(raw);write_manifest(root,manifest)


def run(scene,op='rs.index.ndvi.v1'):
    root,_,request=scene;p=root/'scene.json'
    return execute(op,{'bundle_path':str(p),'bundle_sha256':byte_ref(p.read_bytes()),'request':request})


def test_actual_cogs_mask_counts_and_independent_ndvi(scene):
    result=run(scene);index=result['index']
    assert all(a['cog_layout_marker'] for a in result['assets'].values())
    assert index['valid_count']==13 and index['total_count']==16
    assert index['excluded_counts']=={'nodata':1,'quality_mask':1,'zero_denominator':1,'nonfinite_input':0,'nonfinite_result':0}
    assert index['mean']==pytest.approx(6/13,abs=1e-14)
    expected=[.5,0,None,None,None]+[.5]*11
    for a,b in zip(index['values'],expected):
        assert a is None if b is None else a==pytest.approx(b,abs=1e-14)
    assert result['scene']['valid_time']['start']=='2026-09-26T12:00:00Z'
    assert result['source']['knownAt']=='2026-09-28T12:00:00Z'
    assert result['scene']['scene_cloud_cover_percent'] is None
    assert result['selection']['bounds_xy']==[500000,4799960,500040,4800000]
    assert result['state_admission']=='not_performed' and result['verification_id'] is None


def test_metadata_inspection_does_not_claim_index(scene):
    result=run(scene,'rs.scene.inspect.v1')
    assert result['index'] is None and result['grid']['pixel_basis']=='area'


def test_repeat_execution_new_occurrence_same_result(scene):
    a,b=run(scene),run(scene)
    assert a['provider_execution_id']!=b['provider_execution_id']
    a.pop('provider_execution_id');b.pop('provider_execution_id');assert a==b


def test_declared_offset_applied_before_ratio(tmp_path):
    root=tmp_path/'offset';m,q=make(root,offset=-.05)
    r=run((root,m,q))
    assert r['index']['values'][0]==pytest.approx(2/3,abs=1e-14)
    # The all-zero DN pixel now has nonzero physical denominator and NDVI zero.
    assert r['index']['values'][2]==0 and r['index']['excluded_counts']['zero_denominator']==0


def test_no_implicit_cloud_mask(scene):
    scene[2]['quality']='none';r=run(scene)
    assert r['index']['valid_count']==14 and r['index']['mean']==pytest.approx(13/28)
    assert r['index']['quality_mask'] is None and r['index']['excluded_counts']['quality_mask']==0


def test_all_masked_is_not_zero(scene):
    root,m,q=scene;m['quality']['keep_codes']=[88];write_manifest(root,m)
    r=run(scene)['index'];assert r['status']=='insufficient_data' and r['mean'] is None
    assert all(v is None for v in r['values'])


def test_selected_window_transform(scene):
    scene[2]['window']=[1,1,2,2];r=run(scene)
    assert r['selection']['bounds_xy']==[500010,4799970,500030,4799990]
    assert r['index']['shape']==[2,2] and r['index']['valid_count']==4


@pytest.mark.parametrize('window',[[0,0,0,2],[0,0,65,65],[3,3,2,2],[-1,0,2,2],[0,True,2,2],[0,0,1.5,2]])
def test_invalid_windows_refuse(scene,window):
    scene[2]['window']=window
    with pytest.raises(Refusal):run(scene)


@pytest.mark.parametrize('change,code',[
    (lambda x:x['properties'].__setitem__('proj:epsg',4326),'mixed_crs_basis'),
    (lambda x:x['properties'].__setitem__('proj:shape',[4,5]),'mixed_grid_basis'),
    (lambda x:x['assets']['B08'].__setitem__('proj:transform',[10,0,500001,0,-10,4800000]),'mixed_grid_basis'),
    (lambda x:x['assets']['B04']['raster:bands'][0].__setitem__('sampling','point'),'mixed_pixel_basis'),
    (lambda x:x['assets']['B04']['raster:bands'][0].__setitem__('nodata',0),'nodata_mismatch'),
    (lambda x:x['assets']['B04']['raster:bands'][0].pop('scale'),'unresolved_radiometry'),
    (lambda x:x['assets']['B04']['raster:bands'][0].__setitem__('offset',.1),'radiometry_metadata_conflict'),
    (lambda x:x['assets']['B04']['eo:bands'][0].__setitem__('common_name','green'),'ambiguous_band_mapping'),
    (lambda x:x['properties'].__setitem__('eo:cloud_cover',101),'invalid_cloud_cover'),
    (lambda x:x['properties'].__setitem__('datetime','2026-09-26'),'unresolved_time'),
    (lambda x:x.__setitem__('stac_version','1.1.0'),'unsupported_stac_profile'),
    (lambda x:x['geometry']['coordinates'][0].pop(),'unclosed_footprint')])
def test_ambiguous_stac_metadata_refuses(scene,change,code):
    root,m,q=scene;edit_item(root,m,change)
    with pytest.raises(Refusal,match=code):run(scene)


@pytest.mark.parametrize('kind',['person','mixed','unknown'])
def test_source_yield_gate_precedes_raster_io(scene,kind):
    root,m,q=scene;m['source']['yield_class']=kind;write_manifest(root,m)
    with patch('worker.MemoryFile',side_effect=AssertionError('no asset parsing')):
        with pytest.raises(Refusal,match='person_or_unknown_yield'):run(scene)


def test_href_not_an_executable_source_or_download(scene):
    root,m,q=scene;edit_item(root,m,lambda x:x['assets']['B04'].__setitem__('href','https://127.0.0.1/do-not-request'))
    assert run(scene)['index']['valid_count']==13


@pytest.mark.parametrize('path',['../outside.tif','https://example.com/a.tif','/vsicurl/example.tif','C:\\secret.tif'])
def test_local_asset_paths_only(scene,path):
    root,m,q=scene;m['assets']['B04']['path']=path;write_manifest(root,m)
    with pytest.raises(Refusal,match='local_asset_required'):run(scene)


def test_corrupt_asset_digest_refuses(scene):
    root,m,q=scene;(root/'B04.tif').write_bytes(b'not pinned')
    with pytest.raises(Refusal,match='source_digest_mismatch'):run(scene)


def test_external_mask_is_not_silently_dropped(scene):
    (scene[0]/'B04.tif.msk').write_bytes(b'external mask')
    with pytest.raises(Refusal,match='external_sidecar_not_bound'):run(scene)


def test_non_tiff_cannot_trigger_other_gdal_driver(scene):
    root,m,q=scene;raw=b'<VRTDataset>external</VRTDataset>'
    (root/'B04.tif').write_bytes(raw);m['assets']['B04']['sha256']=byte_ref(raw);write_manifest(root,m)
    with pytest.raises(Refusal,match='geotiff_required'):run(scene)


def test_source_and_input_files_unchanged(scene):
    root,_,_=scene;before={p.name:p.read_bytes() for p in root.iterdir()}
    run(scene)
    assert {p.name:p.read_bytes() for p in root.iterdir()}==before


def test_invalid_json_duplicate_and_nonfinite():
    for raw in (b'{"a":1,"a":2}',b'{"a":NaN}',b'{"a":1e999}'):
        with pytest.raises(ValueError):parse(raw)
