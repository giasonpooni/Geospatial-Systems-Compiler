import type { Pair, Matrix2 } from './observer_benchmark';

/** Closed bounds, not standard deviations or confidence intervals. */
export type Interval = [number, number];
export type StateBox = [Interval, Interval, Interval, Interval];
export type BoundChannel = 'a' | 'b' | 'reference';
export interface BoundContract {
  contractId: string;
  transition: Matrix2;
  initial: StateBox;
  /** Absolute physical operating envelope for loss (L/s) and primary bias (L). */
  nuisanceDomain: [Interval, Interval];
  processAbsLitres: Pair;
  lossIncrementAbs: number;
  biasIncrementAbs: number;
  measurementAbsLitres: [number, number, number];
  maxSteps: number;
  contractionPasses: number;
  maxPrimaryAgeSeconds: number;
  maxReferenceAgeSeconds: number;
  precisionWidthLimits: [number, number, number, number];
}
export interface CalibrationEnvelope {
  calibrationId: string;
  knownAt: string;
  calibratedAt: string;
  validThrough: string;
  /** One shared unknown offset at calibratedAt; not redrawn per observation. */
  offsetLitres: Interval;
  /** Adversarial departure bounded by rate * elapsed seconds, not an iid error. */
  driftAbsLitresPerSecond: number;
  scope: 'synthetic_bound_assumption_not_physical_certificate';
  rowHash: string;
}
export interface BoundReading {
  recordId: string;
  observedAt: string;
  knownAt: string;
  channel: BoundChannel;
  valueLitres: number;
  calibrationId: string | null;
  rowHash: string;
}
export interface BoundInputs {
  contract: BoundContract;
  calibration: CalibrationEnvelope;
  controls: Pair[];
  readings: BoundReading[];
}
export type BoundReason = 'no_recent_primary' | 'no_recent_reference' | 'calibration_unavailable' |
  'calibration_expired' | 'insufficient_precision' | 'inconsistent_assumptions';
export interface BoundResult {
  schema: 'synthetic-bounded-uncertainty-result.v1';
  operationId: 'reference.two-tank-bounded-guard.v1';
  valueKind: 'synthetic';
  asOf: string;
  assumptionHash: string;
  calibrationHash: string | null;
  evidenceHash: string;
  resultHash: string;
  bounds: StateBox | null;
  sharedCalibrationOffset: Interval | null;
  boundBasis: 'conditional_bounded_error_enclosure_not_probability';
  probability: null;
  feasibility: 'not_disproved' | 'inconsistent';
  firstInconsistentAt: string | null;
  lastObservedAt: [string | null, string | null, string | null];
  axisDecisions: Array<{ axis: 0 | 1 | 2 | 3; action: 'within_precision_budget' | 'abstain'; reasons: BoundReason[] }>;
  accounting: { selectedRows: number; assimilatedRows: number; unsupportedReferenceRows: number; unprocessedRows: number; delayedRows: number };
  physicalAssumptionsVerified: false;
}
