import type { Innovation, Matrix2, Pair, TankModel } from './observer_benchmark';

export type Triple = [number, number, number];
export type Matrix3 = [Triple, Triple, Triple];
export interface GaussianLossState { mean: Triple; covariance: Matrix3 }
export interface LossParameters {
  /** Random-walk increment variance in (litres/second)^2 per one-second step. */
  processVariance: number;
  initialVariance: number;
}
export interface LossModel {
  base: TankModel;
  stepSeconds: 1;
  parameters: LossParameters;
  transition: Matrix3;
  processCovariance: Matrix3;
  initial: GaussianLossState;
}
export interface LossObserverResult {
  schema: 'synthetic-tank-loss-result.v1';
  valueKind: 'synthetic';
  operationId: 'reference.two-tank-loss-kalman.v1';
  modelHash: string;
  evidenceHash: string;
  resultHash: string;
  asOf: string;
  state: GaussianLossState;
  /** Units follow each axis: L, L, L/s; cross-covariances have product units. */
  stateUnits: ['litres_deviation', 'litres_deviation', 'litres_per_second'];
  volumeState: { mean: Pair; covariance: Matrix2 };
  interval95: [Pair, Pair, Pair];
  lastObservedAt: [string | null, string | null];
  /** Rank of initial-state observation rows; NOT current-state precision. */
  initialStateInformationRank: 0 | 1 | 2 | 3;
  lossSupport: 'model_only' | 'unobserved' | 'indirect_estimate';
  interpretation: 'net_outflow_equivalent_not_causal_attribution';
  assimilation: { usedRows: number; delayedRows: number };
  innovations: Innovation[];
}
export interface LossExecution {
  executionId: string;
  result: LossObserverResult;
  verification: { status: 'not_verified'; verificationId: null };
}
