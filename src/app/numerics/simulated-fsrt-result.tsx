import { SYNTHETIC_NOTICE, type SimulatedFsrtInspection } from '../../lib/notation/simulated-fsrt-view';
import { FsrtNumericalPanels } from './fsrt-result';

export function SimulatedFsrtResult({ inspection }: { inspection: SimulatedFsrtInspection }) {
  const { source, view, data, stages, held, representationId } = inspection;
  return <section className="min-w-0 space-y-5" aria-label="Simulated fluid snapshot">
    <header className="space-y-2">
      <h2 className="text-xl font-semibold">Simulated fluid snapshot</h2>
      <p className="rounded border p-3 font-semibold">Simulated observation — not a physical measurement or calibration.</p>
      <p>Declared producer: {source.producer.engine} {source.producer.version}</p>
      <p>State owner: {source.producer.state_owner} · Clock owner: {source.producer.clock_owner}</p>
      <p aria-label="Simulation clock">Simulation tick {source.clock.tick} at {source.clock.ticks_per_second} ticks/s · {source.clock.phase} · {source.clock.tick / source.clock.ticks_per_second} s</p>
      <p>The workspace’s local selection interval is not elapsed simulation time. Frame: {source.frame}; unit: {source.unit}.</p>
      <p>Entity / sensor order: {source.entity_ids.map((id, i) => `${id} / ${source.source_ids[i]}`).join(' · ')}</p>
      <p className="font-mono break-all" aria-label="Source engine occurrence">Engine execution: {source.producer.execution_id}</p>
      <p className="font-mono break-all" aria-label="Estimator occurrence">Estimator execution: {view.execution.execution_id}</p>
    </header>
    <FsrtNumericalPanels data={data} held={held} stages={stages} refusal={view.execution.refusal} />
    <p>{SYNTHETIC_NOTICE}</p>
    <p>No simulator reference-state artifact is included. Inspection does not run an engine, estimator, or reference calculation.</p>
    <details><summary>Representation, source and original result identities</summary>
      <pre className="max-w-full overflow-auto p-2">{JSON.stringify({representationId, source, retained: view}, null, 2)}</pre>
    </details>
  </section>;
}
