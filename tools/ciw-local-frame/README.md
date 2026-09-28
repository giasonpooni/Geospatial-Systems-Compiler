# Local-frame representation worker

Optional, first-slice GSC provider for the existing NET/CIW pinned subprocess
adapter. The browser application and prior compiler branches are unchanged.

This is coordinate representation compilation, not a GNSS receiver, estimator,
sensor-fusion algorithm, simulation runtime, or evidence admission service.
PROJ performs WGS84 geodetic -> geocentric -> local topocentric conversion.

## Contract

The existing `ciw.adapter-request.v1` envelope selects `gsc.local-frame.v1`.
Its `inputs` contains only `origin: [longitude_deg, latitude_deg,
ellipsoidal_height_m]` and `samples: [coordinate | null, ...]`.

The response uses existing `ciw.adapter-response.v1` success/refusal semantics.
The successful payload is `gsc.local-frame-output.v1` with east/north/up metres,
origin, source-axis convention, declared runtime/pipeline, unchanged missing
samples, unavailable uncertainty, and `representation_only` authority.

Bounds: 1–4096 samples, 2 MiB input, WGS84 longitudes [-180,180], latitudes
[-90,90], ellipsoidal heights [-1000,100000] metres; every complete point must
lie within a 20 km Euclidean radius of the declared ENU origin. This is not a
20 km geodesic-accuracy claim. Orthometric/MSL heights are unsupported. Values
are neither geoid-corrected nor imputed. Scene meshes and physics are absent.

## Execute and test

Use Python 3.11+ with `pyproj==3.7.2`; the actual PROJ version is reported.
The worker disables PROJ network access in its own process. NET's existing
`PinnedSubprocessAdapter` supplies explicit checkout/interpreter/source-tree
binding and execution/IO limits. This is trusted local code, not a security
sandbox or authentication of installed dependency binaries.

```sh
python -m pip install -r tools/ciw-local-frame/requirements.txt
python -m pytest tools/ciw-local-frame/test_worker.py -q
```

The tests include an independent analytic equatorial oracle and an independent
ECEF-plus-rotation calculation. They do not establish geodetic survey accuracy,
uncertainty propagation, physical calibration or global-frame suitability.

No browser service is started. No GSC default branch or existing PR is merged.
The matching NET change adds `python -m ciw.spatial_workflow` on the existing Session and operation
registry; it does not vendor this worker into NET.

Primary API reference: https://pyproj4.github.io/pyproj/stable/api/transformer.html
