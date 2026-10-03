/** Post-hoc sampling diagnostic; never replaces the fixed 128-replication check. */
import { readFileSync } from 'node:fs';
import { matchedFixture, terminal } from './consistency';
import { checkSelection } from './experiment_v2';
const selection=JSON.parse(readFileSync(process.argv[2]??'runtime-data/synthetic-switching-v2/selection.json','utf8'));
checkSelection(selection);
const rows=Array.from({length:1024},(_,i)=>{
  const seed=10000+i,r=terminal(matchedFixture(seed,selection.parameters,true));return {seed,nees:r.nees,nis:r.predictiveNis};
});
console.log(JSON.stringify({purpose:'posthoc_sampling_diagnostic_not_replacement_for_fixed_128_seed_test',startSeed:10000,count:rows.length,
  meanNees:rows.reduce((s,r)=>s+r.nees,0)/rows.length,meanNis:rows.reduce((s,r)=>s+r.nis,0)/rows.length,rows},null,2));
