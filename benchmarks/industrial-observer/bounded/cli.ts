import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { evaluate, protocol, protocolHash } from './experiment';
import { renderReport } from './report';
import { nextUp, nextDown, plus, minus, scale, divide } from './interval';

const output=resolve(process.argv[2]??'runtime-data/synthetic-bounded-uncertainty');
// mkdir without recursive on the leaf: never overwrite a retained experiment.
mkdirSync(resolve(output,'..'),{recursive:true});mkdirSync(output);
const executionId=`synthetic-execution:${randomUUID()}`;
writeFileSync(resolve(output,'protocol-record.json'),JSON.stringify({protocol,protocolHash:protocolHash(),executionId,startedAt:new Date().toISOString(),
  verification:{status:'not_verified',verificationId:null},note:'Local pre-evaluation record, not externally timestamped preregistration.'},null,2)+'\n',{flag:'wx'});
const start=performance.now(),report=evaluate();
writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
writeFileSync(resolve(output,'index.html'),renderReport(report),{flag:'wx'});
const numbers=[-1e300,-1,-.3,-Number.MIN_VALUE,-0,0,Number.MIN_VALUE,.1,.2,.3,1,1e300];
const arithmetic=numbers.flatMap(a=>numbers.filter(b=>b!==0&&Math.abs(a+b)<1e308).map(b=>({a,b,sum:plus([a,a],[b,b]),difference:minus([a,a],[b,b])})));
writeFileSync(resolve(output,'arithmetic.json'),JSON.stringify({neighbors:numbers.map(x=>({x,up:nextUp(x),down:nextDown(x)})),arithmetic,
  multiply:[{a:.1,b:.2,bound:scale([.1,.1],.2)},{a:Number.MIN_VALUE,b:.5,bound:scale([Number.MIN_VALUE,Number.MIN_VALUE],.5)}],
  divide:[{a:1,b:3,bound:divide([1,1],3)},{a:-1,b:7,bound:divide([-1,-1],7)}]},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,executionId,durationSeconds:(performance.now()-start)/1000,protocolHash:report.protocolHash,gates:report.gates,status:report.experimentStatus,
  summaries:report.regimes.map(r=>({regime:r.regime,...r.summary}))},null,2));
