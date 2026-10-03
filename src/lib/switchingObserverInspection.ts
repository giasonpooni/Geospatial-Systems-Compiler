import type { SwitchingExecution } from '../types/switching_observer';

/** Read-only projection. Validation here is format checking, not attestation. */
export function toSwitchingObserverInspection(e: SwitchingExecution) {
  const r=e.result;
  if(r.schema!=='synthetic-tank-switching-result.v1'||r.operationId!=='reference.two-tank-loss-bias-imm.v1'||r.valueKind!=='synthetic'||
    r.causalAttribution!=='not_established'||r.modeWeightMeaning!=='model_conditional_not_fault_probability'||
    r.intervalBasis!=='equal_tail_of_approximate_imm_mixture'||e.verification.status!=='not_verified'||e.verification.verificationId!==null||
    !/^synthetic-execution:[a-zA-Z0-9-]+$/.test(e.executionId)||![r.modelHash,r.evidenceHash,r.resultHash].every(v=>/^[a-f0-9]{64}$/.test(v)))throw new TypeError('Unsupported retained switching result.');
  const ms=Date.parse(r.asOf);
  if(!Number.isFinite(ms)||new Date(ms).toISOString()!==r.asOf||
    JSON.stringify(r.stateUnits)!==JSON.stringify(['litres_deviation','litres_deviation','litres_per_second','litres'])||
    !Array.isArray(r.state.mean)||r.state.mean.length!==4||!r.state.mean.every(Number.isFinite)||
    !Array.isArray(r.state.covariance)||r.state.covariance.length!==4||!r.state.covariance.every((row,i)=>Array.isArray(row)&&row.length===4&&row.every(Number.isFinite)&&row[i]>0)||
    !Array.isArray(r.modeWeights)||r.modeWeights.length!==4||r.modeWeights.some(v=>!Number.isFinite(v)||v<0||v>1)||Math.abs(r.modeWeights.reduce((s,v)=>s+v,0)-1)>1e-9||
    !Array.isArray(r.interval95)||r.interval95.length!==4)throw new TypeError('Invalid result dimensions or metadata.');
  if(!Array.isArray(r.lastObservedAt)||r.lastObservedAt.length!==2||r.lastObservedAt.some(v=>v!==null&&(!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)>ms))||
    ![0,1,2,3,4].includes(r.initialStateInformationRank)||![r.lossSupport,r.biasSupport].every(v=>['model_only','not_identifiable','structurally_identifiable'].includes(v)))throw new TypeError('Invalid support metadata.');
  const currentUpdateStatus=r.lastObservedAt.some(v=>v===r.asOf)?'measurement_update':'prediction_only';
  const ids=['synthetic:tank:a','synthetic:tank:b','synthetic:tank:b:loss','synthetic:sensor:b:offset'];
  const rows=r.state.mean.map((estimate,d)=>{
    const interval=r.interval95[d];if(!Array.isArray(interval)||interval.length!==2||!interval.every(Number.isFinite)||interval[0]>interval[1])throw new TypeError('Invalid interval.');
    return {stateId:ids[d],estimate,interval95:[...interval],unit:r.stateUnits[d],
      support:d===2?r.lossSupport:d===3?r.biasSupport:r.lastObservedAt[d]===null?'no_direct_measurement':r.lastObservedAt[d]===r.asOf?'measurement_conditioned':'prediction_only'};
  });
  return {asOf:r.asOf,rows,currentUpdateStatus,lastObservedAt:[...r.lastObservedAt],modeWeights:[...r.modeWeights],modeWeightMeaning:r.modeWeightMeaning,initialStateInformationRank:r.initialStateInformationRank,
    operationId:r.operationId,executionId:e.executionId,modelHash:r.modelHash,evidenceHash:r.evidenceHash,resultHash:r.resultHash,
    causalAttribution:r.causalAttribution,verification:{...e.verification},integrityStatus:'format_checked_not_cryptographically_verified' as const};
}
