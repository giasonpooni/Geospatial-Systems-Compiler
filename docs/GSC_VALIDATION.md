# GSC consolidation validation

## Verified browser consolidation

The consolidation gate run `36362289254` materialized and SHA-256-checked the source tree, installed with `npm ci`, passed strict TypeScript checks, ran all 1,260 application tests, built Next.js, and exercised the production application in Chromium. Only after all steps passed did it commit `c38bd7bfcfc0066c7cd5a0742deeaf799fc522d4` to the integration branch. No default-branch merge or public deployment was performed.

The root suite includes wrappers around 73 compiler/temporal Node regressions and all 90 original GSV provider/seam/view-tool Node tests. These nested suites are not additional top-level Vitest test counts.

The production-browser harness passed 16 assertions covering map/globe/table selection, separate event and knowledge clocks, recomputed synthetic state, withholding later-known values, remount/disposal, container resize and mobile layout. It recorded zero uncaught/console errors and zero external requests from the bounded demonstration. This is Chromium ANGLE/SwiftShader software WebGL, not a physical-GPU benchmark or qualification of every browser.

## Post-capture geometry audit

Visual inspection found discontinuities where normalized source longitudes crossed the dateline. `mapGeometry.ts` now unwraps longitudes into a continuous display chart for MapLibre. It preserves latitude, additional ordinates and all original samples; no observation, source IR, identity or CRS is rewritten. Polygon holes stay on their exterior's chart. Explicitly closed polar winding rings retain their supplied cap convention. Five focused regressions cover both crossing directions, input detachment, polygon holes, polar winding and every original GSV route.

`.github/workflows/gsc-browser.yml` is the permanent **read-only** acceptance gate for this implementation, including the geometry correction. It repeats locked installation, types, all regression tests, production build and browser tests; its result must be checked on the exact tested commit. New screenshots and logs are attached as run artifacts. Temporary source-transfer/materialization workflows and payload files were removed after consolidation.

## Naming and responsibility compatibility

The default branch's documentation rename is retained: the project is **Geospatial Systems Compiler (GSC)**, at `giasonpooni/Geospatial-Systems-Compiler`. Payload Terminal V0 is historical lineage, not another canonical corpus. **Notations Engineering Terminal** is the existing CIW workbench. Existing package, route, source, environment and runtime identities remain stable; the old homepage controller moved unchanged to `/terminal`.

ESM release import and CIW spatial-service handoffs are still unconnected. Native instrument-result import, vector/tensor fields, advanced covariance views, complete original GSV cinematic/particle/layer-control parity and physical-GPU performance qualification remain outstanding. Source provenance and record admission are not equivalent to public-publication permission.

The documented historical inability to install/test locally is superseded by the source/dependency workspace and actual results above. The new browser and replay code is implemented and tested; the remaining external connections are not represented as delivered functionality.
