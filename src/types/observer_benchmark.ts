/** Synthetic, two-tank reference contracts; no production source admission. */
export type Pair = [number, number];
export type Matrix2 = [Pair, Pair];
export interface GaussianState { mean: Pair; covariance: Matrix2 }
export interface TankModel {
  transition: Matrix2;
  processCovariance: Matrix2;
  initial: GaussianState;
}
export interface TankReading {
  recordId: string;
  observedAt: string;
  knownAt: string;
  sensor: 0 | 1;
  valueLitres: number;
  noiseVarianceLitres2: number;
  referenceVarianceLitres2: number;
  rowHash: string;
}
export interface Innovation {
  recordId: string;
  observedAt: string;
  residualLitres: number;
  varianceLitres2: number;
  normalizedSquared: number;
}
export interface ObserverResult {
  schema: 'synthetic-tank-observer-result.v1';
  valueKind: 'synthetic';
  operationId: 'reference.two-tank-kalman.v1';
  modelHash: string;
  evidenceHash: string;
  resultHash: string;
  asOf: string;
  state: GaussianState;
  interval95Litres: [Pair, Pair];
  lastObservedAt: [string | null, string | null];
  informationRank: 0 | 1 | 2;
  assimilation: { usedRows: number; delayedRows: number };
  innovations: Innovation[];
}
export interface ObserverExecution {
  executionId: string;
  result: ObserverResult;
  /** A hash or successful test is not a scientific verification certificate. */
  verification: { status: 'not_verified'; verificationId: null };
}
