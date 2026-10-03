import type { SwitchingResult } from './switching_observer';

/** Internal synthetic-reference contracts, not a production acquisition API. */
export interface ReferenceSpecification {
  calibrationId: string;
  noiseFamily: 'synthetic:reference:b:iid';
  loading: 'tank_b' | 'tank_b_plus_primary_bias';
  varianceLitres2: number;
  calibrationStatus: 'synthetic_known_offset_assumption';
}
export interface ReferenceReading {
  recordId: string;
  observedAt: string;
  knownAt: string;
  valueLitres: number;
  varianceLitres2: number;
  calibrationId: string;
  noiseFamily: string;
  rowHash: string;
}
export interface ReferenceResult extends Omit<SwitchingResult, 'schema' | 'operationId' | 'assimilation'> {
  schema: 'synthetic-tank-reference-result.v1';
  operationId: 'reference.two-tank-imm-independent-measurement.v1';
  measurementModelHash: string;
  primaryEvidenceHash: string;
  referenceSpecification: ReferenceSpecification;
  lastReferenceObservedAt: string | null;
  assimilation: { usedRows: number; primaryRows: number; referenceRows: number; delayedRows: number };
}
