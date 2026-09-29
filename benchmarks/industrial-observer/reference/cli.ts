import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { evaluate, fixture, frozenParameters, gaussianCheck, observabilityDiagnostic, protocol, protocolHash, references, trial } from './experiment';
import { makeModel } from '../switching/observer';
import { renderReport } from './report';

const output=resolve(process.argv[2]??'runtime-data/synthetic-independent-reference');
// Exclusive directory: never replace an earlier protocol or evaluation.
mkdirSync(resolve(output,'..'),{recursive:true});mkdirSync(output);
const save=(name:string,value:unknown)=>writeFileSync(resolve(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
save('protocol-record.json',{protocol,protocolHash:protocolHash(),recordedAt:new Date().toISOString(),note:'Local pre-evaluation record, not externally timestamped registration.'});
console.log('Protocol frozen; evaluating the five predeclared measurement arms.');
const evaluation=evaluate();save('evaluation.json',evaluation);
console.log(JSON.stringify({status:evaluation.status,gates:evaluation.gates,ratios:evaluation.combined.ratios},null,2));
const observability=observabilityDiagnostic(),consistency=gaussianCheck();
save('gaussian-fixtures.json',consistency.rows);
const examples=protocol.regimes.map(regime=>{
 const f=fixture(regime,protocol.heldOutSeeds.start),reference=references(f,'independent_4s'),run=trial(f,'independent_4s',true);
 return {regime,seed:f.seed,executionId:`synthetic-execution:${randomUUID()}`,verification:{status:'not_verified',verificationId:null},
  fixture:{model:makeModel(f.model,frozenParameters),controls:f.controls,readings:f.readings,references:reference.rows,spec:reference.spec,truth:f.truth},metrics:run.metrics,series:run.series};
});
const report={schema:'synthetic-reference-report.v1',protocol,evaluation,observability,gaussian:{protocol:consistency.protocol,meanNees:consistency.meanNees,scope:consistency.scope},examples};
save('report.json',report);writeFileSync(resolve(output,'index.html'),renderReport(report),{flag:'wx'});
console.log(JSON.stringify({output,gaussianMeanNees:consistency.meanNees,examples:examples.length}));
