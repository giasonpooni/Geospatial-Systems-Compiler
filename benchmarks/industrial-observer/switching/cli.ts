import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as v1 from './experiment';
import * as v2 from './experiment_v2';
import { runConsistency, matchedFixture } from './consistency';
import { makeModel } from './observer';
import { renderReport } from './report';
import { hash } from '../core';
import { toSwitchingObserverInspection } from '../../../src/lib/switchingObserverInspection';

const phase=process.argv[2],version=process.argv[3]??'v2';
if(!['select','evaluate','report'].includes(phase)||!['v1','v2'].includes(version))throw new TypeError('Usage: cli.ts select|evaluate|report v1|v2 [output-directory]');
const output=resolve(process.argv[4]??`runtime-data/synthetic-switching-${version}`);mkdirSync(output,{recursive:true});
const save=(name:string,value:unknown)=>writeFileSync(resolve(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const load=(name:string)=>JSON.parse(readFileSync(resolve(output,name),'utf8'));
const assertAbsent=(name:string)=>{try{readFileSync(resolve(output,name));throw new Error('Refusing to replace a retained artifact; choose a new directory.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}};
if(phase==='select') {
  assertAbsent('selection.json');save('selection.json',version==='v1'?v1.selectDevelopment():v2.selectDevelopment());
} else {
  const selection=load('selection.json');
  if(version==='v1')v1.checkSelection(selection);else v2.checkSelection(selection);
  if(phase==='evaluate') {
    assertAbsent('evaluation.json');save('evaluation.json',version==='v1'?v1.evaluate(selection):v2.evaluate(selection));
  } else {
    assertAbsent('report.json');const evaluation=load('evaluation.json');
    if(evaluation.selectionHash!==selection.selectionHash||evaluation.protocolHash!==selection.protocolHash)throw new TypeError('Evaluation binding mismatch.');
    const consistency=runConsistency(selection.parameters,version==='v1'?v1.protocol.consistency.firstSeed:8000);
    const examples=evaluation.regimes.map((row:{regime:string})=>{
      const f=version==='v1'?v1.fixture(row.regime as v1.Regime,4000):v2.fixture(row.regime,7000);
      const result=v1.trial(f,selection.parameters,true);const executionId=`synthetic-execution:${randomUUID()}`;
      const last=result.series[result.series.length-1].candidate;
      return {fixture:{...f,model:makeModel(f.model,selection.parameters)},executionId,metrics:result.metrics,series:result.series,
        inspection:toSwitchingObserverInspection({executionId,result:last,verification:{status:'not_verified',verificationId:null}})};
    });
    const report={schema:'synthetic-switching-report.v1',version,selection,evaluation,consistency,examples};
    save('report.json',report);
    save('consistency-fixtures.json',consistency.groups.flatMap(g=>g.rows.map(row=>({seed:row.seed,expected:row,fixture:matchedFixture(row.seed,selection.parameters,g.collapsed)}))));
    writeFileSync(resolve(output,'index.html'),renderReport(report),{flag:'wx'});
    save('content-manifest.json',{protocolHash:selection.protocolHash,selectionHash:selection.selectionHash,evaluationHash:hash('synthetic-switching-evaluation.v1',evaluation),
      note:'Content identity is not source authentication or scientific verification.'});
  }
}
console.log(JSON.stringify({phase,version,output}));
