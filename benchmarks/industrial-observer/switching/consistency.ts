import { at, hash, requireCondition as check, sealReading } from '../core';
import { generateFixture } from '../experiment';
import type { TankReading } from '../../../src/types/observer_benchmark';
import type { SwitchingParameters } from '../../../src/types/switching_observer';
import { makeModel, initialize, advance, summarize } from './observer';
import { apply, chol } from './numerics';

export const GAUSSIAN_REFERENCE_BANDS = { nees: [3.385403925614514, 4.673268395440529], nis: [0.707368209711181, 1.3512302253495814] } as const;
export const CONSISTENCY_PROTOCOL = { startSeed: 8000, replications: 128, terminalStep: 48 } as const;
export function random(seed: number) {
  let state=seed>>>0;
  const uniform=()=>{state=(state+0x6D2B79F5)>>>0;let z=Math.imul(state^(state>>>15),1|state);z^=z+Math.imul(z^(z>>>7),61|z);return (((z^(z>>>14))>>>0)+.5)/4294967296;};
  return {uniform,normal:()=>Math.sqrt(-2*Math.log(uniform()))*Math.cos(2*Math.PI*uniform())};
}
export function matchedFixture(seed:number, parameters:SwitchingParameters, collapsed=false) {
  const base=generateFixture('full',seed,CONSISTENCY_PROTOCOL.terminalStep);
  const p=collapsed?{...parameters,quietLossVariance:.001,jumpLossVariance:.001,quietBiasVariance:.002,jumpBiasVariance:.002}:parameters;
  const m=makeModel(base.model,p),rng=random(seed);
  const sample=(cov:number[][])=>apply(chol(cov),[rng.normal(),rng.normal(),rng.normal(),rng.normal()]);
  const truth:number[][]=[sample(m.initial.covariance)], modes:number[]=[0];const readings:TankReading[]=[];
  for(let t=1;t<=base.controls.length;t++) {
    const u=rng.uniform();let cumulative=0,mode=3;
    for(let j=0;j<4;j++){cumulative+=m.modeTransition[modes[t-1]][j];if(u<cumulative){mode=j;break;}}
    modes.push(mode);const mean=apply(m.transition,truth[t-1]),noise=sample(m.processCovariances[mode]);
    truth.push(mean.map((v,d)=>v+noise[d]+(d<2?base.controls[t-1][d]:0)));
    for(const sensor of [0,1] as const) {
      const variance=sensor===0?.25:.64;
      readings.push(sealReading({recordId:`synthetic:tank:${sensor===0?'a':'b'}:${t}`,observedAt:at(t),knownAt:at(t),sensor,
        valueLitres:truth[t][sensor]+(sensor===1?truth[t][3]:0)+Math.sqrt(variance)*rng.normal()+.2*rng.normal(),noiseVarianceLitres2:variance,referenceVarianceLitres2:.04}));
    }
  }
  return {model:m,controls:base.controls,readings,truth,modes,collapsed};
}
export function nees(mean:number[],cov:number[][],truth:number[]):number {
  const l=chol(cov),z=[0,0,0,0];
  for(let i=0;i<4;i++){let v=truth[i]-mean[i];for(let j=0;j<i;j++)v-=l[i][j]*z[j];z[i]=v/l[i][i];}
  return z.reduce((s,v)=>s+v*v,0);
}
export function terminal(f:ReturnType<typeof matchedFixture>) {
  let state=initialize(f.model);let predictiveNis=0;
  for(let t=1;t<=f.controls.length;t++) {
    const batch=f.readings.slice((t-1)*2,t*2);
    if(t===f.controls.length) {
      const prior=summarize(advance(f.model,state,f.controls[t-1],[])).state;
      predictiveNis=(batch[0].valueLitres-prior.mean[0])**2/(prior.covariance[0][0]+batch[0].noiseVarianceLitres2+batch[0].referenceVarianceLitres2);
    }
    state=advance(f.model,state,f.controls[t-1],batch);
  }
  const result=summarize(state),truth=f.truth[f.truth.length-1];
  return {...result,components:state.components,modeWeights:state.modeWeights,nees:nees(result.state.mean,result.state.covariance,truth),predictiveNis,
    covered:truth.map((v,d)=>v>=result.interval95[d][0]&&v<=result.interval95[d][1])};
}
/** Exact chi-square reference applies ONLY when modes are identical Gaussians. */
export function runConsistency(parameters:SwitchingParameters, startSeed: number = CONSISTENCY_PROTOCOL.startSeed) {
  check(Number.isInteger(startSeed) && startSeed >= 0 && startSeed <= 1000000, 'Invalid consistency seed range.');
  const groups=[true,false].map(collapsed=>{
    const rows=Array.from({length:CONSISTENCY_PROTOCOL.replications},(_,i)=>{
      const seed=startSeed+i+(collapsed?0:1000);const f=matchedFixture(seed,parameters,collapsed);const r=terminal(f);
      return {seed,fixtureHash:hash('synthetic-imm-consistency-fixture.v1',f),...r};
    });
    const meanNees=rows.reduce((s,r)=>s+r.nees,0)/rows.length,meanNis=rows.reduce((s,r)=>s+r.predictiveNis,0)/rows.length;
    const decide=(value:number,band:readonly number[])=>value<band[0]?'below_band':value>band[1]?'above_band':'within_band';
    return {collapsed,meanNees,meanNis,referenceBandCheck:collapsed?{bands:GAUSSIAN_REFERENCE_BANDS,nees:decide(meanNees,GAUSSIAN_REFERENCE_BANDS.nees),nis:decide(meanNis,GAUSSIAN_REFERENCE_BANDS.nis)}:null,coverage:[0,1,2,3].map(d=>rows.reduce((s,r)=>s+Number(r.covered[d]),0)/rows.length),
      interpretation:collapsed?'linear_gaussian_exact_collapse_reference':'approximate_mixture_descriptive_no_chi_square_gate',rows};
  });
  check(groups.length===2,'Expected both reference groups.');return {protocol:{...CONSISTENCY_PROTOCOL,startSeed},groups};
}
