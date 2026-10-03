/** Server-side compilation of an ESM-reinspected internal source snapshot.
 * References and hashes bind bytes, not source truth or release authority.
 */
import {createHash} from 'node:crypto';
import {SOURCE_REGISTRY} from '../economy/sourceRegistry';

export const INDUSTRIAL_FILES = ['station.json','water-level.json','terrain-service.json','terrain.tif','terrain-grid.json'] as const;
export const digest = (bytes:Uint8Array|string):string => 'sha256:'+createHash('sha256').update(bytes).digest('hex');
const HASH=/^sha256:[0-9a-f]{64}$/;
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
function check(ok:unknown,code:string):asserts ok{if(!ok)throw new Error(code);}
function number(x:unknown,lo:number,hi:number):x is number{return typeof x==='number'&&Number.isFinite(x)&&x>=lo&&x<=hi;}
function instant(x:unknown):x is string{return typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;}
/** Deterministic JSON of the public transfer envelope; no private ESM implementation. */
export function stableJson(x:unknown,depth=0):string{
  check(depth<24,'JSON_DEPTH_LIMIT');
  if(x===null||typeof x==='boolean'||typeof x==='string')return JSON.stringify(x);
  if(typeof x==='number'){check(Number.isFinite(x),'NONFINITE_JSON');return JSON.stringify(x);}
  if(Array.isArray(x))return '['+x.map(v=>stableJson(v,depth+1)).join(',')+']';
  check(object(x),'INVALID_JSON');
  return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stableJson(x[k],depth+1)).join(',')+'}';
}
function readJson(bytes:Uint8Array):Record<string,any>{check(bytes.length>0&&bytes.length<=8*1024*1024,'INPUT_SIZE_LIMIT');const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));check(object(v),'INVALID_JSON');return v;}
export interface WaterSample {time:string;valueM:number|null;sigmaM:number|null;quality:'preliminary'|'verified';flags:string;firstFlagRole:'outlier_count'|'inferred';}
export interface ReviewProjection {
  schema:'gsc.industrial-review.v1'; audience:'INTERNAL';status:'UNADMITTED_SOURCE_REVIEW';
  canonicalAdmission:false;release:null;compiledAt:string;captureManifestDigest:string;esmReviewDigest:string;
  operation:string;executionId:string;verification:'LOCAL_HASH_BINDINGS_ONLY';
  sources:{file:string;sourceId:string;digest:string;retrievedAt:string;acquisitionDigest:string}[];
  station:{id:string;name:string;latitude:number;longitude:number;horizontalDatum:'not-declared-by-response';markerAltitudeM:null};
  water:{unit:'m';verticalDatum:'NAVD88';sourcePublishedAt:null;retrievedAt:string;samples:WaterSample[];
    expectedCadenceMs:360000;staleAfterMs:1080000;sigmaMeaning:'standard-deviation-of-1-second-samples';latestObservedAt:string|null;};
  terrain:{width:number;height:number;affine:number[];bounds:number[];horizontalCrs:'EPSG:4269';verticalDatum:'NAVD88';unit:'m';
    heights:(number|null)[];pixelInterpretation:'area-center';resampling:'provider-nearest';surveyedAt:null;retrievedAt:string;
    rawArtifactDigest:string;gridDigest:string;minimumM:number;maximumM:number;missingCells:number;};
  nonclaims:{sourceAuthenticated:false;independentVerification:false;datumTransformation:false;floodModel:false;navigation:false;releaseAuthorization:false;};
}
function verifyScope(urlText:unknown,index:number):void{
  check(typeof urlText==='string','INVALID_SOURCE_URL');const u=new URL(urlText);
  const service='/arcgis/rest/services/3DEPElevation/ImageServer';
  const paths=['/mdapi/prod/webapi/stations/9414290.json','/api/prod/datagetter',service,service+'/exportImage'];
  check(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.hostname===(index<2?'api.tidesandcurrents.noaa.gov':'elevation.nationalmap.gov')&&u.pathname===paths[index],'SOURCE_SCOPE_MISMATCH');
  const keys=[...u.searchParams.keys()];check(new Set(keys).size===keys.length,'DUPLICATE_QUERY_PARAMETER');
  const spec:Record<string,string>=index===0?{}:index===1?{date:'recent',station:'9414290',product:'water_level',datum:'NAVD',time_zone:'gmt',units:'metric',application:'NotationSystemsQualification',format:'json'}:
    index===2?{f:'pjson'}:{bbox:'-122.55,37.72,-122.35,37.92',bboxSR:'4269',imageSR:'4269',size:'129,129',format:'tiff',pixelType:'F32',noData:'-999999',interpolation:'RSP_NearestNeighbor',adjustAspectRatio:'false',f:'image'};
  check(keys.length===Object.keys(spec).length+(index===3?1:0)&&Object.entries(spec).every(([k,v])=>u.searchParams.get(k)===v),'SOURCE_SCOPE_MISMATCH');
  if(index===3){const rr=JSON.parse(u.searchParams.get('renderingRule')??'null');check(object(rr)&&Object.keys(rr).length===1&&rr.rasterFunction==='None','SOURCE_SCOPE_MISMATCH');}
}
function decimal(x:unknown,lo:number,hi:number):number|null{
  if(x===null||x==='')return null;
  check(typeof x==='string'&&/^-?\d+(?:\.\d+)?$/.test(x),'INVALID_READING');const v=Number(x);check(number(v,lo,hi),'INVALID_READING');return v;
}
/** Trusted local selection is supplied by the CLI, never by an unauthenticated API. */
export function compileIndustrialReview(input:{manifest:Uint8Array;review:Uint8Array;files:ReadonlyMap<string,Uint8Array>;compiledAt:string;executionId:string}):ReviewProjection{
  check(instant(input.compiledAt)&&/^execution:[a-z0-9-]{1,80}$/.test(input.executionId),'INVALID_EXECUTION');
  for(const id of ['noaa-coops','usgs-3dep']){
    const sources=SOURCE_REGISTRY.filter(s=>s.sourceId===id);
    check(sources.length===1&&sources[0].adapter==='industrial-source-capture-v1'&&sources[0].accessClass==='open'&&sources[0].yields.includes('observation'),'SOURCE_NOT_REGISTERED');
  }
  const m=readJson(input.manifest),r=readJson(input.review),manifestDigest=digest(input.manifest);
  check(m.schema==='gsc.industrial-capture.v1'&&m.status==='CAPTURED_UNADMITTED'&&m.canonicalAdmission===false&&m.release===null&&m.stationId==='9414290','INVALID_CAPTURE');
  check(r.schema==='payload.industrial-source-review.v1'&&r.audience==='INTERNAL'&&r.integrity==='RECOMPUTED_LOCAL'&&r.policyAuthority==='OPERATOR_DECLARATION'&&r.canonicalAdmission===false&&r.release===null&&r.customerDistributionPermitted===false&&r.sourceTruthClaimed===false&&r.independentVerification===false,'INVALID_ESM_REVIEW');
  const {digest:reviewDigest,...body}=r;
  check(HASH.test(reviewDigest)&&digest(stableJson(body))===reviewDigest&&r.captureManifestDigest===manifestDigest,'ESM_REVIEW_BINDING_MISMATCH');
  check(instant(m.capturedAt)&&instant(r.inspectedAt)&&Date.parse(m.capturedAt)<=Date.parse(r.inspectedAt)&&Date.parse(r.inspectedAt)<=Date.parse(input.compiledAt),'INVALID_CLOCK_ORDER');
  check(Array.isArray(m.artifacts)&&m.artifacts.length===4&&Array.isArray(r.bindings)&&r.bindings.length===5&&input.files.size===5,'INVALID_SELECTION');
  const sources:ReviewProjection['sources']=[];
  for(let i=0;i<5;i++){
    const file=INDUSTRIAL_FILES[i],b=r.bindings[i],a=i<4?m.artifacts[i]:m.derived,raw=input.files.get(file);
    check(raw&&raw.length>0&&raw.length<=8*1024*1024&&object(a)&&a.file===file&&object(b)&&b.file===file,'INVALID_SOURCE_FILE');
    const hash=digest(raw),sourceId=i<2?'noaa-coops':i<4?'usgs-3dep':'gsc-usgs-grid';
    const retrievedAt=i<4?a.retrievedAt:m.capturedAt;
    check(a.sha256===hash&&a.bytes===raw.length&&b.contentDigest===hash&&b.byteLength===raw.length&&b.sourceId===sourceId&&b.retrievedAt===retrievedAt&&HASH.test(b.acquisitionDigest)&&b.acquisitionId===`industrial:${manifestDigest.slice(7)}:${file}`,'SOURCE_BINDING_MISMATCH');
    check(instant(retrievedAt)&&Date.parse(retrievedAt)<=Date.parse(m.capturedAt),'INVALID_SOURCE_TIME');
    if(i<4){verifyScope(a.url,i);check(a.sourceId===sourceId&&a.acquisitionKind==='LIVE_CAPTURE'&&a.sourcePublishedAt===null&&instant(a.requestedAt)&&Date.parse(a.requestedAt)<=Date.parse(retrievedAt),'INVALID_SOURCE_CAPTURE');}
    sources.push({file,sourceId,digest:hash,retrievedAt,acquisitionDigest:b.acquisitionDigest});
  }
  const stationDoc=readJson(input.files.get('station.json')!),feed=readJson(input.files.get('water-level.json')!),service=readJson(input.files.get('terrain-service.json')!),grid=readJson(input.files.get('terrain-grid.json')!);
  check(Array.isArray(stationDoc.stations)&&stationDoc.stations.length===1&&object(stationDoc.stations[0]),'STATION_NOT_UNIQUE');const station=stationDoc.stations[0];
  check(station.id==='9414290'&&station.name==='San Francisco'&&number(station.lat,-90,90)&&number(station.lng,-180,180),'STATION_SCOPE_MISMATCH');
  check(object(feed.metadata)&&feed.metadata.id===station.id&&!feed.error&&Array.isArray(feed.data)&&feed.data.length<=2048,'INVALID_FEED');
  const latitude=decimal(feed.metadata.lat,-90,90),longitude=decimal(feed.metadata.lon,-180,180);
  check(latitude!==null&&longitude!==null&&Math.abs(latitude-station.lat)<0.001&&Math.abs(longitude-station.lng)<0.001,'STATION_POSITION_DISAGREEMENT');
  let last=-Infinity;const samples:WaterSample[]=feed.data.map((x:unknown)=>{
    check(object(x)&&Object.keys(x).every(k=>['t','v','s','f','q'].includes(k))&&['t','v','s','f','q'].every(k=>Object.hasOwn(x,k)),'INVALID_READING_FIELDS');
    check(typeof x.t==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x.t),'INVALID_OBSERVATION_TIME');const time=x.t.replace(' ','T')+':00.000Z';
    check(instant(time)&&Date.parse(time)>last&&Date.parse(time)<=Date.parse(sources[1].retrievedAt),'INVALID_OBSERVATION_TIME');last=Date.parse(time);
    check(x.q==='p'||x.q==='v','UNSUPPORTED_QUALITY');check(typeof x.f==='string'&&/^\d+,[01],[01],[01]$/.test(x.f),'INVALID_FLAGS');
    check(Number.isSafeInteger(Number(x.f.split(',')[0]))&&(x.q==='p'||Number(x.f.split(',')[0])<=1),'INVALID_FLAGS');
    return {time,valueM:decimal(x.v,-100,100),sigmaM:decimal(x.s,0,100),quality:x.q==='p'?'preliminary':'verified',flags:x.f,firstFlagRole:x.q==='p'?'outlier_count':'inferred'};
  });
  check(service.pixelType==='F32'&&service.bandCount===1,'TERRAIN_SERVICE_MISMATCH');
  check(grid.schema==='gsc.terrain-grid.v1'&&grid.width===129&&grid.height===129&&grid.horizontalCrs==='EPSG:4269'&&grid.verticalDatum==='NAVD88'&&grid.units==='m'&&grid.pixelInterpretation==='area-center'&&grid.rowOrder==='north-to-south'&&grid.resampling==='provider-nearest'&&grid.surveyedAt===null,'TERRAIN_BASIS_MISMATCH');
  check(grid.sourceArtifact===sources[3].digest&&m.derived.sourceArtifact===sources[3].digest,'TERRAIN_LINEAGE_MISMATCH');
  check(Array.isArray(grid.bounds)&&grid.bounds.length===4&&grid.bounds.every((n:unknown,i:number)=>number(n,-180,180)&&Math.abs(n-[-122.55,37.72,-122.35,37.92][i])<1e-8),'TERRAIN_EXTENT_MISMATCH');
  check(Array.isArray(grid.affine)&&grid.affine.length===6&&grid.affine.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n))&&grid.affine[1]===0&&grid.affine[3]===0,'INVALID_AFFINE');
  const [dx,,x0,,,y0]=grid.affine,dy=grid.affine[4];check(dx>0&&dy<0&&Math.abs(x0-grid.bounds[0])<1e-8&&Math.abs(y0-grid.bounds[3])<1e-8&&Math.abs(x0+dx*129-grid.bounds[2])<1e-8&&Math.abs(y0+dy*129-grid.bounds[1])<1e-8,'GRID_EXTENT_DISAGREEMENT');
  check(Array.isArray(grid.heights)&&grid.heights.length===129*129&&grid.heights.every((x:unknown)=>x===null||number(x,-500,9000)),'INVALID_HEIGHTS');
  const values=grid.heights.filter((x:unknown):x is number=>x!==null);check(values.length>0&&grid.missingCells===129*129-values.length&&grid.minimumM===Math.min(...values)&&grid.maximumM===Math.max(...values),'TERRAIN_SUMMARY_MISMATCH');
  return {
    schema:'gsc.industrial-review.v1',audience:'INTERNAL',status:'UNADMITTED_SOURCE_REVIEW',canonicalAdmission:false,release:null,compiledAt:input.compiledAt,captureManifestDigest:manifestDigest,esmReviewDigest:reviewDigest,
    operation:'gsc.industrial-source-review.compile.v1',executionId:input.executionId,verification:'LOCAL_HASH_BINDINGS_ONLY',sources,
    station:{id:station.id,name:station.name,latitude:station.lat,longitude:station.lng,horizontalDatum:'not-declared-by-response',markerAltitudeM:null},
    water:{unit:'m',verticalDatum:'NAVD88',sourcePublishedAt:null,retrievedAt:sources[1].retrievedAt,samples,expectedCadenceMs:360000,staleAfterMs:1080000,sigmaMeaning:'standard-deviation-of-1-second-samples',latestObservedAt:samples.at(-1)?.time??null},
    terrain:{width:129,height:129,affine:[...grid.affine],bounds:[...grid.bounds],horizontalCrs:'EPSG:4269',verticalDatum:'NAVD88',unit:'m',heights:[...grid.heights],pixelInterpretation:'area-center',resampling:'provider-nearest',surveyedAt:null,retrievedAt:sources[3].retrievedAt,rawArtifactDigest:sources[3].digest,gridDigest:sources[4].digest,minimumM:grid.minimumM,maximumM:grid.maximumM,missingCells:grid.missingCells},
    nonclaims:{sourceAuthenticated:false,independentVerification:false,datumTransformation:false,floodModel:false,navigation:false,releaseAuthorization:false},
  };
}
