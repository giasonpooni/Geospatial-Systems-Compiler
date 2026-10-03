import type { Pair, TankModel } from './observer_benchmark';

export interface Gaussian4 { mean: number[]; covariance: number[][] }
export interface SwitchingParameters {
  jumpProbability: number;
  /** Optional extensions; absent preserves the first diagnostic candidate. */
  modePersistence?: number;
  lossJumpCoupling?: 0 | 1;
  quietLossVariance: number;
  quietBiasVariance: number;
  jumpLossVariance: number;
  jumpBiasVariance: number;
  initialLossVariance: number;
  initialBiasVariance: number;
}
export interface SwitchingModel {
  base: TankModel;
  parameters: SwitchingParameters;
  transition: number[][];
  measurementRows: number[][];
  modeNames: ['quiet', 'loss_change', 'bias_change', 'combined_change'];
  /** Row i to column j: Pr(next mode j | previous mode i). */
  modeTransition: number[][];
  processCovariances: number[][][];
  initial: Gaussian4;
  initialModeWeights: number[];
}
export interface SwitchingState {
  components: Gaussian4[];
  modeWeights: number[];
}
export interface SwitchingResult {
  schema: 'synthetic-tank-switching-result.v1';
  operationId: 'reference.two-tank-loss-bias-imm.v1';
  valueKind: 'synthetic';
  asOf: string;
  modelHash: string;
  evidenceHash: string;
  resultHash: string;
  stateUnits: ['litres_deviation', 'litres_deviation', 'litres_per_second', 'litres'];
  state: Gaussian4;
  components: Gaussian4[];
  modeWeights: number[];
  modeWeightMeaning: 'model_conditional_not_fault_probability';
  interval95: Pair[];
  intervalBasis: 'equal_tail_of_approximate_imm_mixture';
  initialStateInformationRank: number;
  lossSupport: 'model_only' | 'not_identifiable' | 'structurally_identifiable';
  biasSupport: 'model_only' | 'not_identifiable' | 'structurally_identifiable';
  lastObservedAt: [string | null, string | null];
  assimilation: { usedRows: number; delayedRows: number };
  causalAttribution: 'not_established';
}
export interface SwitchingExecution {
  executionId: string;
  result: SwitchingResult;
  verification: { status: 'not_verified'; verificationId: null };
}
