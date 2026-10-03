import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { evaluateHeldOut, HELD_OUT_REGIMES, lossFixture, protocolHash, runTrial, selectOnDevelopment, type Selection } from './experiment';
import { matchedFixture, runLossConsistency } from './consistency';
import { augmentLossModel } from './observer';
import { toLossObserverInspection } from '../../../src/lib/lossObserverInspection';
import { renderLossReport } from './report';
import { hash } from '../core';

const command = process.argv[2];
const output = resolve(process.argv[3] ?? 'runtime-data/synthetic-loss-observer');
if (!['select', 'evaluate'].includes(command)) throw new TypeError('Usage: cli.ts select|evaluate [output-directory]');
mkdirSync(output, { recursive: true });
const save = (name: string, data: unknown) => writeFileSync(resolve(output, name), JSON.stringify(data, null, 2)+'\n');
if (command === 'select') {
  // Refuse to silently replace an existing calibration record or its holdout.
  try { readFileSync(resolve(output, 'selection.json')); throw new Error('Selection already exists; choose a new directory for a new experiment.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const selection = selectOnDevelopment(); save('selection.json', selection);
  console.log(JSON.stringify({ output, phase: command, parameters: selection.selectedParameters, selectionHash: selection.selectionHash }, null, 2));
} else {
  try { readFileSync(resolve(output, 'report.json')); throw new Error('Evaluation already exists; copy the selection to a new directory for another execution.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const selection = JSON.parse(readFileSync(resolve(output, 'selection.json'), 'utf8')) as Selection;
  const evaluation = evaluateHeldOut(selection);
  const consistency = runLossConsistency(selection.selectedParameters);
  const examples = HELD_OUT_REGIMES.map(regime => {
    const fixture = lossFixture(regime, evaluation.seeds[0]);
    const trial = runTrial(fixture, selection.selectedParameters, true);
    const executionId = `synthetic-execution:${randomUUID()}`;
    const series = trial.series.map(row => ({ step: row.step, baseline: { state: row.baseline.state, interval95: row.baseline.interval95Litres },
      augmented: { state: row.augmented.state, interval95: row.augmented.interval95, informationRank: row.augmented.initialStateInformationRank,
        lossSupport: row.augmented.lossSupport, resultHash: row.augmented.resultHash, evidenceHash: row.augmented.evidenceHash },
      evaluationTruth: row.evaluationTruth,
    }));
    const inspection = toLossObserverInspection({ executionId, result: trial.series[trial.series.length-1].augmented, verification: { status: 'not_verified', verificationId: null } });
    return { regime, seed: fixture.seed, fixtureHash: trial.fixtureHash, model: augmentLossModel(fixture.model, selection.selectedParameters),
      controls: fixture.controls, readings: fixture.readings, initialTruth: fixture.truth[0], metrics: trial.metrics, inspection, series };
  });
  const report = { schema: 'synthetic-loss-comparison.v1', protocolHash: protocolHash(), selection, evaluation, consistency, examples };
  save('report.json', report);
  save('consistency-fixtures.json', consistency.rows.map(row => ({ ...row, fixture: matchedFixture(row.seed, selection.selectedParameters) })));
  writeFileSync(resolve(output, 'index.html'), renderLossReport(report));
  save('content-manifest.json', { schema: 'synthetic-loss-content.v1', protocolHash: report.protocolHash,
    selectionHash: selection.selectionHash, evaluationHash: hash('synthetic-loss-evaluation.v1', evaluation),
    consistencyHash: consistency.contentHash, note: 'Digests bind content, not authorship or scientific verification.' });
  console.log(JSON.stringify({ output, phase: command, status: evaluation.candidateStatus, gates: evaluation.gates,
    lossRmseRatio: evaluation.combinedLosses.rmseRatio, lossCoverage: evaluation.combinedLosses.augmentedCoverage,
    meanNees3: consistency.meanNees3, meanNis: consistency.meanNis }, null, 2));
}
