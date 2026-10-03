"""Bounded STAC/local-GeoTIFF specialist. NET dispatches; this worker owns IO/math.

Copyright (c) 2026 Giason Pooni. Distributed under the existing GSC project licence.
No remote asset loading, source registry, ESM admission, release or person inference.
"""
from __future__ import annotations

from contextlib import ExitStack
from datetime import datetime
from hashlib import sha256
import json
import math
from pathlib import Path, PurePosixPath
import platform
import re
import sys
import uuid

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.windows import Window, bounds as window_bounds, transform as window_transform

OPS = {"rs.scene.inspect.v1", "rs.index.ndvi.v1"}
JSON_LIMIT = 256 * 1024
ASSET_LIMIT = 32 * 1024 * 1024
PIXEL_LIMIT = 4096
AUTHORITY = {"state_admission": "not_performed", "state_release": "not_performed",
             "verification_id": None, "verification_status": "not_verified"}


class Refusal(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def need(value, code):
    if not value:
        raise Refusal(code)


def keys(value, expected):
    need(type(value) is dict and set(value) == set(expected), "invalid_contract")


def text(value):
    need(type(value) is str and 0 < len(value) <= 512 and value.strip(), "invalid_text")
    return value


def number(value):
    need(type(value) in (int, float) and math.isfinite(value) and abs(value) <= 1e100, "invalid_number")
    return value


def ref(value):
    need(type(value) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", value), "invalid_reference")
    return value


def byte_ref(raw):
    return "sha256:" + sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value):
    return byte_ref(encode(value))


def parse(raw):
    need(0 < len(raw) <= JSON_LIMIT, "json_budget")
    def pairs(items):
        value = {}
        for k, v in items:
            need(k not in value, "duplicate_json_key")
            value[k] = v
        return value
    def bad(_):
        raise Refusal("nonfinite_json")
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=bad)
    def check(v, depth=0):
        need(depth <= 16, "json_depth")
        if type(v) is dict:
            need(len(v) <= 256, "json_budget")
            for k, x in v.items(): text(k); check(x, depth + 1)
        elif type(v) is list:
            need(len(v) <= PIXEL_LIMIT, "json_budget")
            for x in v: check(x, depth + 1)
        elif type(v) in (int, float): number(v)
        elif type(v) is str: need(len(v) <= 8192, "json_budget")
        else: need(v is None or type(v) is bool, "invalid_json")
    check(value)
    return value


def timestamp(value):
    text(value)
    # Preserve literal precision/offset. No guessing dates or naive local times.
    need(re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value), "unresolved_time")
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    need(stamp.utcoffset() is not None, "unresolved_time")
    return stamp


def read_file(root, descriptor, limit):
    keys(descriptor, {"path", "sha256"})
    path = PurePosixPath(text(descriptor["path"]))
    need(not path.is_absolute() and all(re.fullmatch(r"[A-Za-z0-9_.-]+", p) and p not in (".", "..") for p in path.parts), "local_asset_required")
    current = root
    for part in path.parts:
        current = current / part
        need(not current.is_symlink(), "local_asset_required")
    need(current.is_file(), "local_asset_required")
    with current.open("rb") as stream:
        raw = stream.read(limit + 1)
    need(0 < len(raw) <= limit, "asset_budget")
    need(byte_ref(raw) == ref(descriptor["sha256"]), "source_digest_mismatch")
    return raw


def runtime():
    return {"provider": "GSC.RS", "worker_sha256": byte_ref(Path(__file__).read_bytes()),
            "python": platform.python_version(), "numpy": np.__version__,
            "rasterio": rasterio.__version__, "gdal": rasterio.__gdal_version__,
            "proj": rasterio.__proj_version__}


def source_metadata(value):
    keys(value, {"id", "knownAt", "license_posture", "license_ref", "lineage_refs",
                 "collection_policy_ref", "radiometry_ref", "yield_class", "product_family"})
    text(value["id"]); timestamp(value["knownAt"]); text(value["product_family"])
    need(value["yield_class"] in ("infrastructure", "land_cover"), "person_or_unknown_yield")
    need(value["license_posture"] in ("public_official", "licensed", "synthetic"), "license_posture_unresolved")
    for k in ("license_ref", "collection_policy_ref", "radiometry_ref"): ref(value[k])
    need(type(value["lineage_refs"]) is list and 1 <= len(value["lineage_refs"]) <= 16, "missing_provenance_source")
    for r in value["lineage_refs"]: ref(r)
    need(len(set(value["lineage_refs"])) == len(value["lineage_refs"]), "duplicate_lineage")


def item_metadata(item):
    need(type(item) is dict and item.get("type") == "Feature" and item.get("stac_version") == "1.0.0", "unsupported_stac_profile")
    for k in ("id", "collection"): text(item.get(k))
    p = item.get("properties")
    need(type(p) is dict and type(item.get("assets")) is dict and type(item.get("links")) is list, "invalid_stac_item")
    if p.get("datetime") is None:
        start, end = p.get("start_datetime"), p.get("end_datetime")
    else:
        need("start_datetime" not in p and "end_datetime" not in p, "ambiguous_valid_time")
        start = end = p["datetime"]
    need(timestamp(start) <= timestamp(end), "unresolved_time")
    # WGS84 Item footprint is NOT the native UTM raster grid.
    geom = item.get("geometry")
    need(type(geom) is dict and geom.get("type") == "Polygon", "unsupported_footprint")
    rings = geom.get("coordinates")
    need(type(rings) is list and len(rings) == 1 and type(rings[0]) is list and 4 <= len(rings[0]) <= 512, "unsupported_footprint")
    ring = rings[0]
    for xy in ring:
        need(type(xy) is list and len(xy) == 2, "unsupported_footprint")
        need(-180 <= number(xy[0]) <= 180 and -90 <= number(xy[1]) <= 90, "unsupported_footprint")
    need(ring[0] == ring[-1], "unclosed_footprint")
    bbox = [min(x[0] for x in ring), min(x[1] for x in ring), max(x[0] for x in ring), max(x[1] for x in ring)]
    need(type(item.get("bbox")) is list and len(item["bbox"]) == 4, "ambiguous_footprint_bbox")
    for v in item["bbox"]: number(v)
    need(item.get("bbox") == bbox and bbox[0] < bbox[2] and bbox[1] < bbox[3] and bbox[2]-bbox[0] <= 180, "ambiguous_footprint_bbox")
    cloud = p.get("eo:cloud_cover")
    if cloud is not None: need(0 <= number(cloud) <= 100, "invalid_cloud_cover")
    text(p.get("platform"))
    need(type(p.get("instruments")) is list and len(p["instruments"]) >= 1, "missing_sensor")
    for v in p["instruments"]: text(v)
    return {"scene_id": item["id"], "collection": item["collection"], "platform": p["platform"],
            "instruments": p["instruments"], "valid_time": {"start": start, "end": end},
            "footprint": {"type": "Polygon", "coordinates": [ring]}, "footprint_crs": "OGC:CRS84", "footprint_status": "declared_not_geometrically_verified",
            "scene_cloud_cover_percent": cloud, "cloud_cover_scope": "scene_metadata_not_window_measurement"}


def inspect_raster(raw, asset, pixel_basis, common, stack):
    need(raw[:4] in (b'II*\x00', b'MM\x00*', b'II+\x00', b'MM\x00+'), "geotiff_required")
    mem = stack.enter_context(MemoryFile(raw))
    ds = stack.enter_context(mem.open(driver="GTiff", GEOREF_SOURCES="INTERNAL"))
    need(ds.count == 1 and not ds.subdatasets and not ds.gcps[0] and ds.rpcs is None, "unsupported_raster_georeferencing")
    need(ds.crs is not None and ds.crs.to_epsg() is not None, "unresolved_crs")
    epsg = ds.crs.to_epsg()
    need(32601 <= epsg <= 32660 or 32701 <= epsg <= 32760, "unsupported_crs_profile")
    a, b, c, d, e, f = list(ds.transform)[:6]
    need(b == 0 and d == 0 and a > 0 and e < 0, "unsupported_grid_orientation")
    need(0 < ds.width <= 40000 and 0 < ds.height <= 40000, "raster_shape_budget")
    need(max(h*w for h,w in ds.block_shapes) <= 1024*1024, "raster_block_budget")
    need(ds.dtypes[0] in ("uint8", "uint16", "int16", "uint32", "int32", "float32", "float64"), "unsupported_data_type")
    declared = dict(common)
    declared.update(asset)  # STAC asset projection overrides Item defaults.
    need(declared.get("proj:epsg") == epsg and type(declared.get("proj:epsg")) is int, "mixed_crs_basis")
    shape = declared.get("proj:shape")
    need(type(shape) is list and all(type(v) is int for v in shape) and shape == [ds.height, ds.width], "mixed_grid_basis")
    tr = declared.get("proj:transform")
    need(type(tr) is list and len(tr) in (6, 9) and tr[:6] == [a,b,c,d,e,f], "mixed_grid_basis")
    for v in tr: number(v)
    if len(tr) == 9: need(tr[6:] == [0,0,1], "mixed_grid_basis")
    need(ds.tags().get("AREA_OR_POINT", "").lower() == pixel_basis, "mixed_pixel_basis")
    bands = asset.get("raster:bands")
    need(type(bands) is list and len(bands) == 1, "missing_raster_band_metadata")
    band = bands[0]
    need(band.get("sampling") == pixel_basis and band.get("data_type") == ds.dtypes[0], "mixed_pixel_basis")
    need("nodata" in band, "missing_nodata_declaration")
    nd = band["nodata"]
    if nd == "nan": need(ds.nodata is not None and math.isnan(ds.nodata), "nodata_mismatch")
    elif nd is None: need(ds.nodata is None, "nodata_mismatch")
    else: need(number(nd) == ds.nodata, "nodata_mismatch")
    grid = {"crs": f"EPSG:{epsg}", "axis_order": ["easting", "northing"], "coordinate_epoch": None,
            "shape": [ds.height, ds.width], "transform": [a,b,c,d,e,f], "pixel_basis": pixel_basis}
    metadata = {"dtype": ds.dtypes[0], "nodata": nd, "tiff_scale": ds.scales[0], "tiff_offset": ds.offsets[0],
                "cog_layout_marker": ds.tags(ns="IMAGE_STRUCTURE").get("LAYOUT") == "COG",
                "cog_conformance": "not_certified", "block_shapes": [list(v) for v in ds.block_shapes]}
    return ds, band, grid, metadata


def execute(operation, inputs):
    need(operation in OPS, "operation_unavailable")
    keys(inputs, {"bundle_path", "bundle_sha256", "request"})
    q = inputs["request"]
    keys(q, {"investigation_id", "room", "entity", "aoi_ref", "window", "quality"})
    text(q["investigation_id"]); ref(q["aoi_ref"])
    need(q["room"] in ("PAYLOAD", "LANDSHARK", "TRADEWIND"), "unknown_room")
    keys(q["entity"], {"kind", "id"}); text(q["entity"]["id"])
    need(q["entity"]["kind"] in ("organization", "site", "shipment"), "person_or_unknown_yield")
    need(q["quality"] in ("declared_mask", "none"), "unknown_mask_policy")
    w = q["window"]
    need(type(w) is list and len(w) == 4 and all(type(v) is int and v >= 0 for v in w), "invalid_pixel_window")
    col, row, width, height = w
    need(width > 0 and height > 0 and width*height <= PIXEL_LIMIT, "pixel_window_budget")
    path = Path(inputs["bundle_path"])
    need(path.is_absolute() and not any(x.is_symlink() for x in (path, *path.parents)), "local_bundle_required")
    manifest_raw = read_file(path.parent, {"path": path.name, "sha256": inputs["bundle_sha256"]}, JSON_LIMIT)
    m = parse(manifest_raw)
    keys(m, {"schema", "source", "item", "assets", "bands", "quality", "pixel_basis"})
    need(m["schema"] == "gsc.rs-scene.v1", "invalid_contract")
    source_metadata(m["source"])
    need(m["pixel_basis"] in ("area", "point"), "mixed_pixel_basis")
    keys(m["bands"], {"red", "nir", "quality"})
    selected = [m["bands"]["red"], m["bands"]["nir"]]
    if m["bands"]["quality"] is not None: selected.append(m["bands"]["quality"])
    need(len(set(selected)) == len(selected) and set(m["assets"]) == set(selected), "ambiguous_band_mapping")
    for v in selected: text(v)
    if m["quality"] is not None:
        keys(m["quality"], {"keep_codes", "policy_ref"}); ref(m["quality"]["policy_ref"])
        keep = m["quality"]["keep_codes"]
        need(m["bands"]["quality"] is not None and type(keep) is list and 1 <= len(keep) <= 32
             and all(type(x) is int and 0 <= x <= 65535 for x in keep) and len(set(keep)) == len(keep), "invalid_mask_policy")
    else: need(m["bands"]["quality"] is None, "missing_mask_policy")
    need(q["quality"] != "declared_mask" or m["quality"] is not None, "missing_mask_policy")
    item_raw = read_file(path.parent, m["item"], JSON_LIMIT)
    item = parse(item_raw)
    scene = item_metadata(item)
    for entry in m["assets"].values():
        keys(entry, {"path", "sha256"})
        asset_path = path.parent / entry["path"]
        need(not any(Path(str(asset_path)+suffix).exists() for suffix in (".msk", ".ovr", ".aux.xml"))
             and not asset_path.with_suffix(".tfw").exists(), "external_sidecar_not_bound")
    buffers = {k: read_file(path.parent, m["assets"][k], ASSET_LIMIT) for k in selected}
    need(all(k in item["assets"] for k in selected), "missing_stac_asset")
    with ExitStack() as stack:
        # Only pinned in-memory GeoTIFF bytes. No href, VSI path or sidecar is opened.
        stack.enter_context(rasterio.Env(GDAL_PAM_ENABLED="NO", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", PROJ_NETWORK="OFF"))
        datasets, bands, asset_metadata, grid = {}, {}, {}, None
        for key in selected:
            ds, band, basis, meta = inspect_raster(buffers[key], item["assets"][key], m["pixel_basis"], item["properties"], stack)
            need(grid is None or basis == grid, "mixed_grid_basis")
            grid = basis; datasets[key] = ds; bands[key] = band
            asset_metadata[key] = {**meta, "sha256": m["assets"][key]["sha256"]}
        need(col+width <= grid["shape"][1] and row+height <= grid["shape"][0], "pixel_window_outside_scene")
        for role in ("red", "nir"):
            key = m["bands"][role]; band = bands[key]; ds = datasets[key]
            eo = item["assets"][key].get("eo:bands")
            need(type(eo) is list and len(eo) == 1 and eo[0].get("common_name") == role, "ambiguous_band_mapping")
            need(all(k in band for k in ("scale", "offset", "unit")) and band["unit"] == "1", "unresolved_radiometry")
            need(number(band["scale"]) > 0, "unresolved_radiometry"); number(band["offset"])
            need((ds.scales[0],ds.offsets[0]) in ((1.0,0.0),(band["scale"],band["offset"])), "radiometry_metadata_conflict")
            asset_metadata[key].update(scale=band["scale"], offset=band["offset"], unit="1", radiometry_basis="explicit_stac_raster_band")
        grid_ref = digest(grid)
        win = Window(col, row, width, height)
        ds = datasets[m["bands"]["red"]]
        selection = {"window": w, "bounds_xy": list(window_bounds(win, ds.transform)),
                     "transform": list(window_transform(win, ds.transform))[:6], "aoi_ref": q["aoi_ref"],
                     "aoi_relation": "operator_declared_pixel_window_not_polygon_intersection"}
        result = None
        if operation == "rs.index.ndvi.v1":
            red, nir = [datasets[m["bands"][k]].read(1, window=win, masked=True).astype("float64") for k in ("red", "nir")]
            nodata = np.ma.getmaskarray(red) | np.ma.getmaskarray(nir)
            excluded = np.zeros(nodata.shape, dtype=bool)
            if q["quality"] == "declared_mask":
                qds = datasets[m["bands"]["quality"]]
                need(qds.dtypes[0] in ("uint8", "uint16"), "unsupported_quality_dtype")
                codes = qds.read(1, window=win, masked=True)
                excluded = (~nodata) & (np.ma.getmaskarray(codes) | ~np.isin(codes.data, m["quality"]["keep_codes"]))
            rb, nb = [bands[m["bands"][role]] for role in ("red", "nir")]
            with np.errstate(all="ignore"):
                r = red.data*rb["scale"]+rb["offset"]
                n = nir.data*nb["scale"]+nb["offset"]
                eligible = ~(nodata | excluded)
                nonfinite = eligible & (~np.isfinite(n) | ~np.isfinite(r))
                zero = eligible & ~nonfinite & ((n+r) == 0)
                values = np.full(r.shape, np.nan)
                good = eligible & ~nonfinite & ~zero
                np.divide(n-r, n+r, out=values, where=good)
                invalid_result = good & (~np.isfinite(values) | (np.abs(values) > 1e100))
                good &= ~invalid_result
            counts = {"nodata": int(nodata.sum()), "quality_mask": int(excluded.sum()),
                      "nonfinite_input": int(nonfinite.sum()), "zero_denominator": int(zero.sum()),
                      "nonfinite_result": int(invalid_result.sum())}
            valid = values[good]
            result = {"status": "computed" if valid.size else "insufficient_data", "quantity": "ndvi", "unit": "1",
                      "shape": [height,width], "order": "row_major", "values": [float(v) if g else None for v,g in zip(values.ravel(),good.ravel())],
                      "valid_count": int(valid.size), "total_count": width*height, "excluded_counts": counts,
                      "mean": float(valid.mean()) if valid.size else None, "minimum": float(valid.min()) if valid.size else None,
                      "maximum": float(valid.max()) if valid.size else None, "outside_unit_interval_count": int((np.abs(valid)>1).sum()),
                      "quality_mask": m["quality"] if q["quality"] == "declared_mask" else None,
                      "formula": "(scaled_nir-scaled_red)/(scaled_nir+scaled_red)", "clamped": False}
        return {"schema": "gsc.rs-result.v1", "operation_id": operation,
                "provider_execution_id": "gsc-rs-"+uuid.uuid4().hex, "runtime": runtime(),
                "bundle_sha256": byte_ref(manifest_raw), "item_sha256": byte_ref(item_raw), "request_ref": digest(q),
                "source": m["source"], "scene": scene, "grid": grid, "grid_ref": grid_ref,
                "selection": selection, "assets": asset_metadata, "index": result, **AUTHORITY}


def main():
    try:
        envelope = parse(sys.stdin.buffer.read(JSON_LIMIT+1))
        keys(envelope, {"schema", "operation_id", "inputs"})
        need(envelope["schema"] == "ciw.adapter-request.v1", "invalid_contract")
        op = envelope["operation_id"]
        if op == "rs.runtime.v1":
            keys(envelope["inputs"], set()); data = runtime()
        else:
            need(op in OPS, "operation_unavailable")
            data = execute(op, envelope["inputs"])
        response = {"schema":"ciw.adapter-response.v1", "status":"ok", "data":data}
    except (ValueError, TypeError, KeyError, OSError, OverflowError, RecursionError) as exc:
        code = exc.code if isinstance(exc, Refusal) else "invalid_scene_input"
        response = {"schema":"ciw.adapter-response.v1", "status":"refused", "refusal":{"code":code,"message":"GSC scene operation refused: "+code}}
    sys.stdout.buffer.write(encode(response))


if __name__ == "__main__":
    main()
