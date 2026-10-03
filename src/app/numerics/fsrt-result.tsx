import type { FsrtInspection, FsrtData, CovarianceStage } from '../../lib/notation/fsrt-view';

/** A representation of retained values. No equation, solver or control path. */
export function FsrtResult({ inspection }: { inspection: FsrtInspection }) {
  const { view, data, held, stages } = inspection;
  return <section className="min-w-0 space-y-5" aria-label="Fluid snapshot">
    <header>
      <h2 className="text-xl font-semibold">Fluid snapshot</h2>
      <p>{view.source.description}</p>
      <p className="font-mono break-all">{view.execution.operation_id} · {view.execution.execution_id}</p>
      <p>Acquisition: {view.source.observed_at.join(' / ')}</p>
      <p>Clock: {view.source.time_reference} · frame: {view.source.coordinate_frame}</p>
    </header>
    <FsrtNumericalPanels data={data} held={held} stages={stages} refusal={view.execution.refusal} />
    <p>No numerical replay, independent scientific verification, field validation, state admission or equipment permission is produced by this inspection.</p>
    <details><summary>Original result, execution and source records</summary>
      <pre className="max-w-full overflow-auto p-2">{JSON.stringify(view,null,2)}</pre>
    </details>
  </section>;
}

/** Shared numerical presentation only. The source-aware readers validate provenance separately. */
export function FsrtNumericalPanels({ data, held, stages, refusal }: {
  data: FsrtData | null; held: boolean; stages: readonly CovarianceStage[];
  refusal?: { code: string; message: string };
}) {
  return <>
    {!data ? <div className="rounded border p-4" aria-label="Refused fluid execution">
      <h3 className="font-semibold">Execution refused — no estimate produced</h3>
      <p>{refusal?.code}: {refusal?.message}</p>
    </div> : <>
      <div className="rounded border p-4" aria-label="Fluid diagnostic outcome">
        <h3 className="font-semibold">{held ? 'Correction held — original posterior retained' : 'Balance reconciliation returned a conditional estimate'}</h3>
        <p>Physical model: {data.diagnostics.physical_model_status}</p>
        <p>Reconciliation: {data.diagnostics.reconciliation_status}</p>
        <p>Fault attribution: {data.diagnostics.fault_attribution}</p>
        <p>Successful computation is not physical acceptance or a sensor-health certificate.</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left" aria-label="Observed and estimated masses">
        <thead><tr>{['Source / state order','Unit','Observation','Unprojected posterior',held ? 'Retained output (unchanged)' : 'Reconciled output'].map(x => <th className="p-2" key={x}>{x}</th>)}</tr></thead>
        <tbody>{data.calibrated_observation.source_ids.map((id,i) => <tr key={id}>
          <th className="border-t p-2">{id} / tank-{i+1}.mass</th><td className="border-t p-2">kg</td>
          <td className="border-t p-2">{data.calibrated_observation.mask[i] ? String(data.calibrated_observation.values[i]) : 'Missing observation'}</td>
          <td className="border-t p-2">{String(data.unprojected_estimate.values[i])}</td>
          <td className="border-t p-2">{String(data.estimate.values[i])}</td>
        </tr>)}</tbody>
      </table></div>
      <div aria-label="Balance residuals" className="space-y-1">
        <h3 className="font-semibold">Retained residuals</h3>
        <p>Before balance correction (kg): {data.residuals.balance_before.join(', ')}</p>
        <p>After balance correction (kg): {data.residuals.balance_after === null ? 'Not produced — correction held' : data.residuals.balance_after.join(', ')}</p>
        <p>Correction (kg): {data.residuals.correction === null ? 'Not applied' : data.residuals.correction.join(', ')}</p>
        <p>Statistic: {data.diagnostics.consistency_statistic} / declared upper threshold: {data.diagnostics.consistency_threshold}</p>
        <p>This is the instrument’s balance-disagreement diagnostic, not a coverage or NIS/NEES qualification.</p>
      </div>
    </>}
    {stages.length > 0 && <section className="space-y-5" aria-label="Fluid covariance stages">
      <h3 className="font-semibold">Full retained covariance</h3>
      <p>Entry (i, j) has unit i × unit j. Cross terms, ordering and stage identities are retained; no independence or uncertainty is invented.</p>
      {stages.map(stage => <section key={stage.name} aria-label={`Covariance ${stage.name}`}>
        <h4 className="font-semibold">{stage.name}</h4>
        <p className="font-mono break-all text-sm">{stage.covarianceId ?? 'Legacy v1 matrix — no v2 artifact identity supplied'}</p>
        <div className="overflow-x-auto"><table className="w-full text-left">
          <thead><tr><th className="p-2">Quantity / unit</th>{stage.quantityIds.map((id,i) => <th className="p-2" key={id}>{id} / {stage.units[i]}</th>)}</tr></thead>
          <tbody>{stage.matrix.map((row,i) => <tr key={i}><th className="border-t p-2">{stage.quantityIds[i]} / {stage.units[i]}</th>
            {row.map((v,j) => <td className="border-t p-2 font-mono" key={j}>{String(v)}</td>)}
          </tr>)}</tbody>
        </table></div>
      </section>)}
    </section>}
  </>;
}
