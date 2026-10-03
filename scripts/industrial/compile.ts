/** Compile only a locally ESM-reinspected capture; create-only output directory. */
import {constants,openSync,fstatSync,readFileSync,closeSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {INDUSTRIAL_FILES,compileIndustrialReview,digest} from '../../src/lib/spatial/industrialReview';
const [captureRoot,reviewFile,output,permission,...extra]=process.argv.slice(2);
if(!captureRoot||!reviewFile||!output||permission!=='--internal-review-only'||extra.length)throw new Error('Usage: compile CAPTURE_DIR ESM_REVIEW OUTPUT --internal-review-only');
function read(path:string):Buffer{const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const s=fstatSync(fd);if(!s.isFile()||s.size<1||s.size>8*1024*1024)throw new Error('INVALID_LOCAL_FILE');return readFileSync(fd);}finally{closeSync(fd);}}
const projection=compileIndustrialReview({manifest:read(join(captureRoot,'capture.json')),review:read(reviewFile),files:new Map(INDUSTRIAL_FILES.map(f=>[f,read(join(captureRoot,f))])),compiledAt:new Date().toISOString(),executionId:'execution:'+randomUUID()});
const encoded=JSON.stringify(projection),hash=digest(encoded),file=`review-${hash.slice(7)}.json`;
// Only publish the index after the complete referenced bytes have passed readback.
mkdirSync(output,{recursive:false});
writeFileSync(join(output,file),encoded,{flag:'wx'});
if(digest(read(join(output,file)))!==hash)throw new Error('OUTPUT_READBACK_FAILED');
writeFileSync(join(output,'index.json'),JSON.stringify({schema:'gsc.industrial-review-index.v1',audience:'INTERNAL',file,sha256:hash,bytes:Buffer.byteLength(encoded),canonicalAdmission:false,release:null}),{flag:'wx'});
console.log(JSON.stringify({output,sha256:hash,readings:projection.water.samples.length,terrainCells:projection.terrain.heights.length,status:projection.status}));
