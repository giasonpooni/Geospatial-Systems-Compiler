# GSC compiler and shared browser

## Running application

`/` and `/explorer` mount one Next.js investigation interface. `GsvInvestigation` loads the original pinned `SyntheticProvider` through the original `WorldStore`, compiles the validated snapshot, applies temporal selection, then supplies the same source-bound records to MapLibre and Three.js. Selection and both clocks belong to the investigation, not either renderer. No iframe or separate Vite application is started.

`/terminal` retains the old root controller byte-for-byte; `/operations` and the existing API routes remain unchanged. The two inherited panel tests now inspect the moved controller path. Runtime/package/environment identities remain compatible.

## Source migration

`packages/gsv/ORIGIN.json` lists the upstream repository, commit and exact Git blob for every imported file and topology asset. The two edited upstream files additionally name their adapted blob and reason: camera disposal and abortable topology loading. All original provider/store, seam and view-command tests execute from the merged repository through the existing root test command.

The original `Engine` and selection module remain preserved but are not used as the new lifecycle owner: they assume a full-window application and lack complete teardown. `src/lib/gscBrowser/globe.ts` owns a container-bound renderer, observer, requestAnimationFrame loop, controls, scene and textures. It cancels/disposes each and rejects late initialization after unmount. GSV's procedural Globe, Atmosphere, graticule, spherical helpers and camera supply the real rendering machinery.

The original standalone `main.ts`, DOM UI and application coordinator are not started or copied into a second application. Advanced layer/particle components are retained for further parity migration; their presence is not a claim that each original control has been wired into the new shell.

## Compiler

- `ir.ts`: source and representation identities, explicit upstream bindings, scalar quantities, geometry/frame/basis, two clocks, source validity, optional applicability, provenance and uncertainty references.
- `adapters.ts`: GSV snapshot and explicit Payload entity/observation projections. GSV constraints retain top-level applicability independently from provenance validity.
- `payloadDomain.ts`: explicit six-collection Payload projection. Flows, capacities, dependencies and events remain domain records; a flow's endpoints do not manufacture route geometry. Operator and shareholder roles stay distinct. These contracts lack explicit system-known timestamps, so retrieval is marked as a conservative upper bound. The event-end convention is not declared by the old domain contract: occurrence start is normalized but an active interval is not fabricated.
- `compiler.ts`: bounded plain-input checking and explicit identity, temporal, quantity, frame and provenance passes.
- `projections.ts`: table, GeoJSON, time metadata, relation edges and explicitly labelled GSV unit-sphere display vertices.
- `temporal.ts`: actual eligibility filtering, not merely a stored cursor.
- `investigation.ts`: strict view commands, source bindings and local state transitions. It remains independent of computation and evidence governance.

All successful IRs are detached and deeply frozen. Unknown source provenance, coordinate frames, units and uncertainty remain unknown. The unit-sphere representation is display geometry, not ECEF, metric geodesy or a covariance transform.

## Temporal contract

`selectTemporal(ir, { from, at, knownAt })` requires explicit, equally precise time values. Observation history is half-open `[from, at)`; record applicability is checked at `at`. Provider-known time and event time are independent. Later-arriving observations cannot enter before their knowledge cutoff. A conflicting provenance-known time also withholds a record.

Entities with known provenance but no applicability remain **structural context**, not a claim of currently active physical state. Unknown-knowledge records are excluded. Exclusions have explicit reasons; links to excluded records are omitted and counted, rather than leaving dangling references. Original IR and source records are never overwritten.

Raw `sourceRecord` detail is removed from a temporal projection. It may contain future route-history samples, revision payloads or nested fields not yet normalized. Treating its mere presence as time-safe would bypass the filter. Normalized source identity, quantities, provenance and applicable links remain.

GSV dynamic state is a separate, labelled synthetic model response. The original provider is queried at the explicit cursor. If a contributing active event was not known by the knowledge cutoff, the numerical output is unavailable; hiding only the event label would still leak its modelled effect. Providers without the declared model-input knowledge policy are not allowed to claim as-known dynamic state. There is no independence inference, covariance propagation, interpolation of observations or scientific verification.

The demo uses the full original 277-record world, not only compiler fixtures. Node tests still use bounded malformed-input fixtures where appropriate. Date-valued Payload records and UTC-valued GSV records retain their precision; mixed-precision filtering remains explicitly unsupported rather than inventing midnight timestamps.

## Boundary and test commands

```sh
node scripts/test-gsc.mjs
node --import tsx --test packages/gsv/tests/*.test.mjs
node --import tsx packages/gsv/scripts/validate-provenance.mjs
npm test
npx tsc --noEmit
npm run build
# Start the server, then:
node scripts/test-gsc-browser.mjs
```

The compiler test runner statically checks imports, compiles only the pure slice with strict TypeScript and executes its Node regressions. Its ambient types are explicitly limited to Node, preventing Three/WebGPU declarations from becoming accidental compiler dependencies. The check is a development guard, not a JavaScript sandbox.

The browser test uses real Chromium MapLibre/Three.js contexts with software WebGL. It checks source selection across map/globe/table, independent clocks, changed deterministic model values, knowledge-time withholding, remount/dispose, container dimensions and mobile layout. It captures screenshots and fails on uncaught browser/console errors or external public-demo requests. This does not benchmark a physical GPU or certify all supported browsers.

## External seams

The inspected ESM product-desk contract supports exact-release `/earth?release=...` navigation and explicitly gated inquiry APIs. The inspected CIW protocol supports the read-only `/spatial` WebSocket path with configured browser origins and `spatial.list` / `spatial.inspect`. Neither is connected by a guessed generic URL or enabled by source presence. The current default demonstration is deliberately independent of private services.

Live ESM release import, a CIW retained geographic-source adapter, native instrument results, complete original GSV UI parity, vector/tensor fields, advanced uncertainty views and large-volume GPU performance remain separate implementation/validation tasks. No public execution bridge or canonical admission authority is introduced.

The prior foundation's inability to install dependencies locally is superseded: pinned source/dependency artifacts were obtained through read-only Actions. Full local typechecking, compiler tests, inherited provider tests and the production build can now run. The local system Chromium blocks localhost under administrator policy, so real browser acceptance runs in the GitHub Actions gate rather than changing that policy.
