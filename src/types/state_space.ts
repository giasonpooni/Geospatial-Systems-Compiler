import type { Hash, ISODateTime, Provenance } from '../lib/economy/types';

/** This framework's vocabulary; do not replace economy/types.ValueKind. */
export type StateSpaceValueKind =
  | 'official_record'
  | 'curated_representative'
  | 'synthetic'
  | 'research_only';

export interface BaseRecord {
  provenance: Provenance;
  valueKind: StateSpaceValueKind;
  knownAt: ISODateTime;
  /** SHA-256 of the versioned canonical vector, excluding rowHash itself. */
  rowHash: Hash;
}

export interface AsynchronousStateVector extends BaseRecord {
  /** Opaque industrial-entity reference, not proof of anonymization. */
  entityToken: string;
  /** Finite, commensurate input components; no implicit unit conversion. */
  stateTensor: number[];
}

export interface GeospatialFrameMatrix {
  arrayNodeId: string;
  /** [minX, minY, maxX, maxY] in the caller's common frame. Metadata only. */
  spatialBoundingBox: number[];
  /** Finite, nonnegative scalar, not a second vector or a general matrix. */
  nodeCapacityWeight: number;
}

export type StateSpaceVerdict = 'held' | 'strained' | 'unproven' | 'refused';
export type StateSpaceRefusalReason =
  | 'data_fence_violation'
  | 'invalid_input'
  | 'row_hash_mismatch'
  | 'source_not_admitted'
  | 'numeric_overflow';

export interface StateSpaceTransition {
  transitionId: string;
  /** Sum of stateTensor[i] * nodeCapacityWeight; 0 is a sentinel on refusal. */
  compiledDensityIndex: number;
  /** 0 means unestimated, not a calibrated probability of correctness. */
  confidenceWeight: number;
  verdict: StateSpaceVerdict;
  /** Threshold classification is a simulation, never evidence admission. */
  mode: 'simulation';
  confidenceBasis: 'not_estimated';
  inputRowHash: Hash | null;
  inputValueKind: StateSpaceValueKind | null;
  refusalReason: StateSpaceRefusalReason | null;
}

/**
 * Trusted configuration supplied AFTER the existing source/evidence boundary
 * approves an industrial row. Never populate this from the same untrusted
 * request as the vector. This is an exact-row allow-list, not a new source
 * registry, a signature verifier, or a license to admit natural-person data.
 */
export interface StateSpaceAdmission {
  readonly sourceId: string;
  readonly rowHash: Hash;
}
