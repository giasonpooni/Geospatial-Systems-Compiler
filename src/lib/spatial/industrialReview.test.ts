import {describe,it,expect} from 'vitest';
import {compileIndustrialReview,digest,stableJson,INDUSTRIAL_FILES} from './industrialReview';
const at='2026-09-29T06:00:00.000Z';
/** Generated contract fixtures. These are not captured NOAA/USGS or ESM attestations. */
function fixture(){
 const urls=[
  'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/9414290.json',
  'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=recent&station=9414290&product=water_level&datum=NAVD&time_zone=gmt&units=metric&application=NotationSystemsQualification&format=json',
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer?f=pjson',
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-122.55,37.72,-122.35,37.92&bboxSR=4269&imageSR=4269&size=129,129&format=tiff&pixelType=F32&noData=-999999&renderingRule=%7B%22rasterFunction%22%3A%22None%22%7D&interpolation=RSP_NearestNeighbor&adjustAspectRatio=false&f=image'];
 const feed={metadata:{id:'9414290',lat:'37.8063',lon:'-122.4659'},data:[{t:'2026-09-29 05:48',v:'0.0',s:'0.05',f:'2,0,0,0',q:'p'},{t:'2026-09-29 05:54',v:'0.662',s:'0.054',f:'0,0,0,0',q:'v'}]};
 const station={stations:[{id:'9414290',name:'San Francisco',lat:37.806305,lng:-122.46589}]};
 const grid={schema:'gsc.terrain-grid.v1',width:129,height:129,affine:[.2/129,0,-122.55,0,-.2/129,37.92],bounds:[-122.55,37.72,-122.35,37.92],horizontalCrs:'EPSG:4269',verticalDatum:'NAVD88',units:'m',pixelInterpretation:'area-center',rowOrder:'north-to-south',resampling:'provider-nearest',surveyedAt:null,sourceArtifact:digest('TEST-TIFF'),heights:Array(129*129).fill(10),missingCells:0,minimumM:10,maximumM:10};
 const input={manifest:Buffer.alloc(0),review:Buffer.alloc(0),files:new Map<string,Uint8Array>(),compiledAt:at,executionId:'execution:test'};
 const m:any={schema:'gsc.industrial-capture.v1',status:'CAPTURED_UNADMITTED',canonicalAdmission:false,release:null,stationId:'9414290',capturedAt:at,artifacts:[],derived:{}};
 const r:any={schema:'payload.industrial-source-review.v1',audience:'INTERNAL',integrity:'RECOMPUTED_LOCAL',policyAuthority:'OPERATOR_DECLARATION',canonicalAdmission:false,release:null,customerDistributionPermitted:false,sourceTruthClaimed:false,independentVerification:false,inspectedAt:at};
 const seal=()=>{
  input.files=new Map(INDUSTRIAL_FILES.map((f,i)=>[f,Buffer.from(i===3?'TEST-TIFF':JSON.stringify([station,feed,{pixelType:'F32',bandCount:1},null,grid][i]))]));
  m.artifacts=INDUSTRIAL_FILES.slice(0,4).map((file,i)=>({file,sourceId:i<2?'noaa-coops':'usgs-3dep',url:urls[i],sha256:digest(input.files.get(file)!),bytes:input.files.get(file)!.length,requestedAt:at,retrievedAt:at,sourcePublishedAt:null,acquisitionKind:'LIVE_CAPTURE'}));
  m.derived={file:'terrain-grid.json',sha256:digest(input.files.get('terrain-grid.json')!),bytes:input.files.get('terrain-grid.json')!.length,sourceArtifact:grid.sourceArtifact};
  input.manifest=Buffer.from(JSON.stringify(m));const manifestDigest=digest(input.manifest);
  r.captureManifestDigest=manifestDigest;r.bindings=INDUSTRIAL_FILES.map((file,i)=>({file,sourceId:i<2?'noaa-coops':i<4?'usgs-3dep':'gsc-usgs-grid',contentDigest:digest(input.files.get(file)!),byteLength:input.files.get(file)!.length,acquisitionDigest:digest('TEST-ACQUISITION'),acquisitionId:`industrial:${manifestDigest.slice(7)}:${file}`,retrievedAt:at}));
  delete r.digest;r.digest=digest(stableJson(r));input.review=Buffer.from(JSON.stringify(r));
 };
 seal();return {input,feed,station,grid,m,r,urls,seal};
}
describe('internal GSC industrial source review',()=>{
 it('compiles explicit source measurements without admission, altitude or confidence fabrication',()=>{const f=fixture(),p=compileIndustrialReview(f.input);expect(p.water.samples).toHaveLength(2);expect(p.water.samples[0]).toMatchObject({valueM:0,quality:'preliminary',firstFlagRole:'outlier_count',flags:'2,0,0,0'});expect(p.station.markerAltitudeM).toBe(null);expect(p.water.sourcePublishedAt).toBe(null);expect(p.canonicalAdmission).toBe(false);expect(p.release).toBe(null);});
 it('keeps missing readings and sigma null rather than zero',()=>{const f=fixture();f.feed.data[0].v='';f.feed.data[0].s='';f.seal();expect(compileIndustrialReview(f.input).water.samples[0]).toMatchObject({valueM:null,sigmaM:null});});
 it('empty response retains an empty series with no latest observation',()=>{const f=fixture();f.feed.data=[];f.seal();expect(compileIndustrialReview(f.input).water.latestObservedAt).toBe(null);});
 it('detaches normalized terrain from source objects',()=>{const f=fixture(),p=compileIndustrialReview(f.input);p.terrain.heights[0]=999;expect(f.grid.heights[0]).toBe(10);});
 for(const [name,edit] of [
  ['wrong station',(f:any)=>f.station.stations[0].id='other'],['wrong position',(f:any)=>f.feed.metadata.lat='38.0'],
  ['NaN value',(f:any)=>f.feed.data[0].v='NaN'],['whitespace value',(f:any)=>f.feed.data[0].v=' '],
  ['negative sigma',(f:any)=>f.feed.data[0].s='-1'],['unknown quality',(f:any)=>f.feed.data[0].q='x'],
  ['bad flags',(f:any)=>f.feed.data[0].f='0,2,0,0'],['verified count flag',(f:any)=>f.feed.data[1].f='2,0,0,0'],
  ['invalid date',(f:any)=>f.feed.data[0].t='2026-02-30 00:00'],['duplicate time',(f:any)=>f.feed.data[1].t=f.feed.data[0].t],
  ['future data',(f:any)=>f.feed.data[1].t='2026-09-30 00:00'],['extra personal field',(f:any)=>f.feed.data[0].person='PRIVATE'],
  ['datum mutation',(f:any)=>f.urls[1]=f.urls[1].replace('datum=NAVD','datum=MLLW')],
  ['wrong units',(f:any)=>f.urls[1]=f.urls[1].replace('units=metric','units=english')],
  ['CRS mutation',(f:any)=>f.grid.horizontalCrs='EPSG:4326'],['height datum mutation',(f:any)=>f.grid.verticalDatum='WGS84'],
  ['affine mutation',(f:any)=>f.grid.affine[4]=.2/129],['extent mutation',(f:any)=>f.grid.bounds[0]=-123],
  ['grid count',(f:any)=>f.grid.heights.pop()],['unmasked NaN',(f:any)=>f.grid.heights[0]=Infinity],
  ['all nodata',(f:any)=>{f.grid.heights.fill(null);f.grid.missingCells=16641;}],
  ['summary mutation',(f:any)=>f.grid.maximumM=99],['unbound TIFF',(f:any)=>f.grid.sourceArtifact=digest('WRONG')],
  ['invented survey time',(f:any)=>f.grid.surveyedAt=at],
 ] as const)it(`refuses ${name}`,()=>{const f=fixture();edit(f);f.seal();expect(()=>compileIndustrialReview(f.input)).toThrow();});
 it('ESM claims require an exact manifest byte binding',()=>{const f=fixture();f.input.manifest=Buffer.from(JSON.stringify({...f.m,extra:true}));expect(()=>compileIndustrialReview(f.input)).toThrow('ESM_REVIEW_BINDING_MISMATCH');});
 it('cannot change admission or release on the reviewed payload',()=>{for(const [key,value] of [['release','forged'],['canonicalAdmission',true],['audience','PUBLIC']] as const){const f=fixture();f.r[key]=value;delete f.r.digest;f.r.digest=digest(stableJson(f.r));f.input.review=Buffer.from(JSON.stringify(f.r));expect(()=>compileIndustrialReview(f.input)).toThrow('INVALID_ESM_REVIEW');}});
 it('review checksum tampering refuses',()=>{const f=fixture();f.r.digest=digest('WRONG');f.input.review=Buffer.from(JSON.stringify(f.r));expect(()=>compileIndustrialReview(f.input)).toThrow('ESM_REVIEW_BINDING_MISMATCH');});
 it('changed raw bytes refuse even if metadata says reviewed',()=>{const f=fixture();f.input.files.set('station.json',Buffer.from('{}'));expect(()=>compileIndustrialReview(f.input)).toThrow('SOURCE_BINDING_MISMATCH');});
 it('nodata creates a hole, not an invented zero',()=>{const f=fixture();f.grid.heights[0]=null;f.grid.missingCells=1;f.seal();expect(compileIndustrialReview(f.input).terrain.heights[0]).toBe(null);});
});
