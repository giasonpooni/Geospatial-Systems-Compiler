import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  hashStateVector,
  StateSpaceMatrixCompiler,
  SYNTHETIC_STATE_SPACE_SOURCE,
} from '../src/engine/matrix_compiler';
import type {
  AsynchronousStateVector,
  GeospatialFrameMatrix,
  StateSpaceAdmission,
} from '../src/types/state_space';

function vector(overrides: Partial<AsynchronousStateVector> = {}): AsynchronousStateVector {
  const draft = {
    provenance: {
      sourceId: SYNTHETIC_STATE_SPACE_SOURCE,
      sourceName: 'Synthetic industrial test fixture',
      retrievedAt: '2026-09-28T12:00:00Z',
    },
    valueKind: 'synthetic' as const,
    knownAt: '2026-09-28T12:00:00Z',
    entityToken: 'synthetic:equipment:001',
    stateTensor: [0.2, 0.3, 0.4],
    ...overrides,
  };
  return { ...draft, rowHash: hashStateVector(draft) };
}

function frame(overrides: Partial<GeospatialFrameMatrix> = {}): GeospatialFrameMatrix {
  return {
    arrayNodeId: 'synthetic:array:001',
    spatialBoundingBox: [0, 0, 10, 10],
    nodeCapacityWeight: 1,
    ...overrides,
  };
}

function externalVector(): AsynchronousStateVector {
  // A fictional admitted-source fixture, not an assertion about a live source.
  return vector({
    valueKind: 'official_record',
    provenance: {
      sourceId: 'test:reviewed-industrial-equipment',
      sourceName: 'Test-only industrial source',
      retrievedAt: '2026-09-28T12:00:00Z',
    },
  });
}

function admission(input: AsynchronousStateVector): StateSpaceAdmission {
  return { sourceId: input.provenance.sourceId, rowHash: input.rowHash };
}

describe('StateSpaceMatrixCompiler: valid simulation', () => {
  it('combines a tokenized vector with the frame mathematically', () => {
    const compiler = new StateSpaceMatrixCompiler();
    const result = compiler.compileStateIntersection(vector(), frame({ nodeCapacityWeight: 0.5 }));
    assert.ok(Math.abs(result.compiledDensityIndex - 0.45) < 1e-15);
    assert.equal(result.verdict, 'strained');
    assert.equal(result.mode, 'simulation');
    assert.equal(result.confidenceWeight, 0);
    assert.equal(result.confidenceBasis, 'not_estimated');
    assert.equal(result.refusalReason, null);
    assert.equal(compiler.getRefusalCount(), 0);
  });

  const cases = [
    { score: -1, verdict: 'unproven' },
    { score: 0, verdict: 'unproven' },
    { score: 0.35, verdict: 'unproven' },
    { score: 0.35000001, verdict: 'strained' },
    { score: 0.75, verdict: 'strained' },
    { score: 0.75000001, verdict: 'held' },
    { score: 2, verdict: 'held' },
  ] as const;
  for (const { score, verdict } of cases) {
    it(`uses strict thresholds without clamping for score ${score}`, () => {
      const result = new StateSpaceMatrixCompiler().compileStateIntersection(vector({ stateTensor: [score] }), frame());
      assert.equal(result.compiledDensityIndex, score);
      assert.equal(result.verdict, verdict);
    });
  }

  it('uses compensated summation for cancellation', () => {
    const result = new StateSpaceMatrixCompiler().compileStateIntersection(vector({ stateTensor: [1e16, 1, -1e16] }), frame());
    assert.equal(result.compiledDensityIndex, 1);
    assert.equal(result.verdict, 'held');
  });

  it('permits zero capacity without a divide-by-zero', () => {
    const result = new StateSpaceMatrixCompiler().compileStateIntersection(vector(), frame({ nodeCapacityWeight: 0 }));
    assert.equal(result.compiledDensityIndex, 0);
    assert.equal(result.verdict, 'unproven');
  });

  it('accepts a valid timestamp offset without silently rewriting it', () => {
    const input = vector({ knownAt: '2026-09-28T08:00:00.125-04:00' });
    const result = new StateSpaceMatrixCompiler().compileStateIntersection(input, frame());
    assert.equal(result.verdict, 'held');
    assert.equal(input.knownAt, '2026-09-28T08:00:00.125-04:00');
  });
});

describe('StateSpaceMatrixCompiler: security and refusal accounting', () => {
  for (const key of ['phone', 'name', 'email', 'handle', 'Phone_Number', 'EMAIL_ADDRESS', 'deviceId']) {
    it(`refuses an unexpected ${key} field and increments the ledger once`, () => {
      const compiler = new StateSpaceMatrixCompiler();
      const input = { ...vector(), [key]: 'fixture-rejected-value' };
      const result = compiler.compileStateIntersection(input, frame());
      assert.equal(result.verdict, 'refused');
      assert.equal(result.refusalReason, 'data_fence_violation');
      assert.equal(result.compiledDensityIndex, 0);
      assert.equal(result.confidenceWeight, 0);
      assert.equal(result.inputRowHash, null);
      assert.equal(compiler.getRefusalCount(), 1);
      assert.ok(!JSON.stringify(result).includes('fixture-rejected-value'));
    });
  }

  it('finds forbidden keys in nested objects and arrays', () => {
    const compiler = new StateSpaceMatrixCompiler();
    const input = { ...vector(), metadata: { rows: [{ phone: 'fixture-only' }] } };
    const result = compiler.compileStateIntersection(input, frame());
    assert.equal(result.refusalReason, 'data_fence_violation');
    assert.equal(compiler.getRefusalCount(), 1);
  });

  it('checks the frame as well as the vector', () => {
    const compiler = new StateSpaceMatrixCompiler();
    const result = compiler.compileStateIntersection(vector(), { ...frame(), name: 'fixture-only' } as GeospatialFrameMatrix);
    assert.equal(result.refusalReason, 'data_fence_violation');
    assert.equal(compiler.getRefusalCount(), 1);
  });

  it('rejects accessors without invoking their getter', () => {
    const input = vector();
    let reads = 0;
    Object.defineProperty(input, 'stateTensor', { get() { reads += 1; return [1]; } });
    const result = new StateSpaceMatrixCompiler().compileStateIntersection(input, frame());
    assert.equal(result.verdict, 'refused');
    assert.equal(reads, 0);
  });

  it('refuses cycles without recursing indefinitely', () => {
    const input = vector() as AsynchronousStateVector & { cycle?: unknown };
    input.cycle = input;
    assert.equal(new StateSpaceMatrixCompiler().compileStateIntersection(input, frame()).verdict, 'refused');
  });

  it('does not admit an external row solely because it is tokenized', () => {
    const result = new StateSpaceMatrixCompiler().compileStateIntersection(externalVector(), frame());
    assert.equal(result.refusalReason, 'source_not_admitted');
  });

  it('executes an exact row approved by trusted upstream configuration', () => {
    const input = externalVector();
    const compiler = new StateSpaceMatrixCompiler([admission(input)]);
    const result = compiler.compileStateIntersection(input, frame());
    assert.equal(result.verdict, 'held');
    assert.equal(result.inputValueKind, 'official_record');
    assert.equal(result.mode, 'simulation');
    assert.equal(result.confidenceWeight, 0);
  });

  it('does not let one approved row admit a different row from the same source', () => {
    const input = externalVector();
    const compiler = new StateSpaceMatrixCompiler([admission(input)]);
    const changed = vector({ ...input, stateTensor: [9] });
    assert.equal(compiler.compileStateIntersection(changed, frame()).refusalReason, 'source_not_admitted');
  });

  it('copies admissions rather than retaining the caller-owned list', () => {
    const input = externalVector();
    const approvals: StateSpaceAdmission[] = [];
    const compiler = new StateSpaceMatrixCompiler(approvals);
    approvals.push(admission(input));
    assert.equal(compiler.compileStateIntersection(input, frame()).refusalReason, 'source_not_admitted');
  });

  it('does not let a synthetic label alone admit an external source', () => {
    const input = vector({ ...externalVector(), valueKind: 'synthetic' });
    assert.equal(new StateSpaceMatrixCompiler().compileStateIntersection(input, frame()).refusalReason, 'source_not_admitted');
  });

  it('accumulates refusals while successful calls do not alter the count', () => {
    const compiler = new StateSpaceMatrixCompiler();
    compiler.compileStateIntersection({ ...vector(), phone: 'fixture-only' } as AsynchronousStateVector, frame());
    compiler.compileStateIntersection(vector(), frame());
    compiler.compileStateIntersection({ ...vector(), name: 'fixture-only' } as AsynchronousStateVector, frame());
    assert.equal(compiler.getRefusalCount(), 2);
  });

  for (const invalid of [[], [NaN], [Infinity], [-Infinity], new Array<number>(2)]) {
    it(`refuses malformed numeric input ${String(invalid)} without throwing`, () => {
      const compiler = new StateSpaceMatrixCompiler();
      const input = { ...vector(), stateTensor: invalid };
      assert.equal(compiler.compileStateIntersection(input, frame()).refusalReason, 'invalid_input');
      assert.equal(compiler.getRefusalCount(), 1);
    });
  }

  for (const weight of [-1, NaN, Infinity]) {
    it(`refuses invalid capacity ${weight}`, () => {
      assert.equal(new StateSpaceMatrixCompiler().compileStateIntersection(vector(), frame({ nodeCapacityWeight: weight })).refusalReason, 'invalid_input');
    });
  }

  for (const bbox of [[0, 1], [2, 0, 1, 1], [0, 2, 1, 1], [0, 0, Infinity, 1]]) {
    it(`refuses malformed bounds ${bbox.join(',')}`, () => {
      assert.equal(new StateSpaceMatrixCompiler().compileStateIntersection(vector(), frame({ spatialBoundingBox: bbox })).refusalReason, 'invalid_input');
    });
  }

  it('refuses an impossible calendar date', () => {
    const input = { ...vector(), knownAt: '2026-02-30T12:00:00Z' };
    assert.equal(new StateSpaceMatrixCompiler().compileStateIntersection(input, frame()).refusalReason, 'invalid_input');
  });

  it('refuses arithmetic overflow instead of assigning held to Infinity', () => {
    const result = new StateSpaceMatrixCompiler().compileStateIntersection(vector({ stateTensor: [Number.MAX_VALUE] }), frame({ nodeCapacityWeight: 2 }));
    assert.equal(result.refusalReason, 'numeric_overflow');
  });

  it('refuses an unknown valueKind at runtime', () => {
    const input = { ...vector(), valueKind: 'reported' } as unknown as AsynchronousStateVector;
    assert.equal(new StateSpaceMatrixCompiler().compileStateIntersection(input, frame()).refusalReason, 'invalid_input');
  });

  it('fails closed for null input from an untyped caller', () => {
    const compiler = new StateSpaceMatrixCompiler();
    assert.equal(compiler.compileStateIntersection(null as unknown as AsynchronousStateVector, frame()).refusalReason, 'invalid_input');
    assert.equal(compiler.getRefusalCount(), 1);
  });
});

describe('StateSpaceMatrixCompiler: row conservation', () => {
  it('preserves input rows and row hashes across repeated execution', () => {
    const input = vector();
    const spatialFrame = frame();
    const originalHash = input.rowHash;
    const originalInput = JSON.stringify(input);
    const originalFrame = JSON.stringify(spatialFrame);
    Object.freeze(input.provenance);
    Object.freeze(input.stateTensor);
    Object.freeze(input);
    Object.freeze(spatialFrame.spatialBoundingBox);
    Object.freeze(spatialFrame);
    const compiler = new StateSpaceMatrixCompiler();
    const outputs = Array.from({ length: 5 }, () => compiler.compileStateIntersection(input, spatialFrame));
    for (const output of outputs) {
      assert.equal(output.verdict, 'held');
      assert.equal(output.inputRowHash, originalHash);
      assert.equal(output.transitionId, outputs[0].transitionId);
    }
    assert.equal(hashStateVector(input), originalHash);
    assert.equal(JSON.stringify(input), originalInput);
    assert.equal(JSON.stringify(spatialFrame), originalFrame);
    assert.equal(compiler.getRefusalCount(), 0);
  });

  it('detects a stale hash after tensor mutation', () => {
    const input = vector();
    input.stateTensor[0] = 10;
    const compiler = new StateSpaceMatrixCompiler();
    assert.equal(compiler.compileStateIntersection(input, frame()).refusalReason, 'row_hash_mismatch');
    assert.equal(compiler.getRefusalCount(), 1);
  });

  it('hashes knownAt and provenance, not just the floating-point array', () => {
    const input = vector();
    const changed = vector({ ...input, knownAt: '2026-09-29T12:00:00Z' });
    assert.notEqual(input.rowHash, changed.rowHash);
  });

  it('is insensitive to object insertion order', () => {
    const input = vector();
    const reordered = {
      stateTensor: input.stateTensor,
      entityToken: input.entityToken,
      knownAt: input.knownAt,
      valueKind: input.valueKind,
      provenance: {
        retrievedAt: input.provenance.retrievedAt,
        sourceName: input.provenance.sourceName,
        sourceId: input.provenance.sourceId,
      },
    };
    assert.equal(hashStateVector(reordered), input.rowHash);
  });

  it('binds transition identity to frame metadata without claiming a spatial join', () => {
    const compiler = new StateSpaceMatrixCompiler();
    const input = vector();
    const first = compiler.compileStateIntersection(input, frame());
    const moved = compiler.compileStateIntersection(input, frame({ spatialBoundingBox: [10, 10, 20, 20] }));
    assert.notEqual(first.transitionId, moved.transitionId);
    assert.equal(first.compiledDensityIndex, moved.compiledDensityIndex);
    assert.equal(first.inputRowHash, moved.inputRowHash);
  });
});
