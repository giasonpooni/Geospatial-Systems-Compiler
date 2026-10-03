"""Bounded WGS84 -> local ENU representation worker; not a GNSS estimator.

Uses NET's existing ciw.adapter-request/response.v1 subprocess envelope.
PROJ owns coordinate mathematics. This process performs no acquisition or
network access and does not claim calibration, covariance or state admission.
"""
from __future__ import annotations
import json
import math
import sys

OPERATION = "gsc.local-frame.v1"
VERSION = "1"
MAX_BYTES = 2 * 1024 * 1024
MAX_SAMPLES = 4096
MAX_RADIUS_M = 20_000.0
PYPROJ_VERSION = "3.7.2"


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError("Coordinates must be finite JSON numbers")
    return float(value)


def geodetic(value):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError("Coordinates must be [longitude_deg, latitude_deg, ellipsoidal_height_m]")
    lon, lat, height = map(number, value)
    if not -180 <= lon <= 180 or not -90 <= lat <= 90 or not -1000 <= height <= 100_000:
        raise ValueError("Coordinates exceed the declared WGS84 profile")
    return [lon, lat, height]


def compile_local(inputs):
    if not isinstance(inputs, dict) or set(inputs) != {"origin", "samples"}:
        raise ValueError("Require origin and samples only")
    origin = geodetic(inputs["origin"])
    samples = inputs["samples"]
    if not isinstance(samples, list) or not 1 <= len(samples) <= MAX_SAMPLES:
        raise ValueError("Require 1..4096 coordinate samples")
    coordinates = [None if p is None else geodetic(p) for p in samples]
    import pyproj
    from pyproj import Transformer, network
    if pyproj.__version__ != PYPROJ_VERSION:
        raise ValueError("This profile requires pyproj " + PYPROJ_VERSION)
    network.set_network_enabled(False)
    lon, lat, height = origin
    pipeline = ("+proj=pipeline +step +proj=unitconvert +xy_in=deg +xy_out=rad "
                "+step +proj=cart +ellps=WGS84 +step +proj=topocentric +ellps=WGS84 "
                f"+lon_0={lon!r} +lat_0={lat!r} +h_0={height!r}")
    transform = Transformer.from_pipeline(pipeline)
    points = []
    for point in coordinates:
        if point is None:
            points.append(None)
            continue
        local = list(transform.transform(*point, errcheck=True))
        if not all(math.isfinite(v) for v in local) or math.hypot(*local) > MAX_RADIUS_M:
            raise ValueError("Position exceeds the 20 km local-frame radius")
        points.append(local)
    return {"schema": "gsc.local-frame-output.v1", "origin": origin,
            "positions_enu_m": points, "axes": ["east", "north", "up"],
            "unit": "m", "height_reference": "WGS84_ellipsoidal",
            "runtime": {"worker_version": VERSION, "pyproj": pyproj.__version__,
                        "proj": pyproj.proj_version_str, "pipeline": pipeline,
                        "network_enabled": False},
            "uncertainty": {"status": "unavailable", "reason": "not_propagated"},
            "authority": "representation_only"}


def unique_pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("Nonfinite JSON constant")


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("Request exceeds 2 MiB")
        request = json.loads(raw, object_pairs_hook=unique_pairs, parse_constant=reject_constant)
        if (not isinstance(request, dict) or set(request) != {"schema", "operation_id", "inputs"}
                or request["schema"] != "ciw.adapter-request.v1" or request["operation_id"] != OPERATION):
            raise ValueError("Unsupported adapter request")
        data = compile_local(request["inputs"])
        response = {"schema": "ciw.adapter-response.v1", "status": "ok", "data": data}
    except (ValueError, TypeError, KeyError, OverflowError, ImportError) as exc:
        response = {"schema": "ciw.adapter-response.v1", "status": "refused",
                    "refusal": {"code": "LOCAL_FRAME_REFUSED", "message": str(exc) or type(exc).__name__}}
    print(json.dumps(response, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
