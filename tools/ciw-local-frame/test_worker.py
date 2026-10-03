"""Numerical and refusal tests for the real PROJ-backed worker."""
import importlib.util
import math
from pathlib import Path
import pytest

spec=importlib.util.spec_from_file_location("local_frame_worker", Path(__file__).with_name("worker.py"))
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)


def test_equatorial_oracle_and_missingness():
    theta=math.radians(.001);a=6378137.0
    result=worker.compile_local({"origin":[0,0,0],"samples":[[0,0,0],[.001,0,0],None,[0,0,15]]})
    assert result["positions_enu_m"][0] == [0,0,0]
    assert result["positions_enu_m"][1] == pytest.approx([a*math.sin(theta),0,a*(math.cos(theta)-1)], abs=1e-8)
    assert result["positions_enu_m"][2] is None
    assert result["positions_enu_m"][3] == pytest.approx([0,0,15], abs=1e-8)
    assert result["runtime"]["network_enabled"] is False


def test_general_latitude_independent_ecef_rotation():
    origin=[-79.7,44,250];point=[-79.6998,44.0001,252]
    def ecef(p):
        lon,lat,h=p;lon,lat=map(math.radians,(lon,lat))
        a=6378137.;f=1/298.257223563;e2=f*(2-f);n=a/math.sqrt(1-e2*math.sin(lat)**2)
        return [(n+h)*math.cos(lat)*math.cos(lon),(n+h)*math.cos(lat)*math.sin(lon),(n*(1-e2)+h)*math.sin(lat)]
    dx,dy,dz=[a-b for a,b in zip(ecef(point),ecef(origin))]
    lon,lat=map(math.radians,origin[:2]);s,c=math.sin,math.cos
    expected=[-s(lon)*dx+c(lon)*dy,-s(lat)*c(lon)*dx-s(lat)*s(lon)*dy+c(lat)*dz,c(lat)*c(lon)*dx+c(lat)*s(lon)*dy+s(lat)*dz]
    actual=worker.compile_local({"origin":origin,"samples":[point]})["positions_enu_m"][0]
    assert actual == pytest.approx(expected,abs=1e-8)


@pytest.mark.parametrize("bad",[[],[0,0],[True,0,0],[0,float('nan'),0],[181,0,0],[0,91,0],[0,0,-1001]])
def test_bad_coordinate_refused(bad):
    with pytest.raises(ValueError):worker.compile_local({"origin":[0,0,0],"samples":[bad]})


@pytest.mark.parametrize("inputs", [{"origin":[0,0,0],"samples":[]},{"origin":[0,0,0],"samples":[[1,0,0]]},
 {"origin":[0,0,0],"samples":[None]*4097},{"origin":[0,0,0],"samples":[None],"command":"anything"}])
def test_profile_refusal(inputs):
    with pytest.raises(ValueError):worker.compile_local(inputs)


def test_all_missing_is_retained():
    assert worker.compile_local({"origin":[0,0,0],"samples":[None]})["positions_enu_m"] == [None]
