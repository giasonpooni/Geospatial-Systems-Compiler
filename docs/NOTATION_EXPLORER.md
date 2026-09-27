# Notation visual explorer

## Routes and responsibilities

`/notation` is the visualization-first company entry. It is readable without
ESM or WebGL; its graphic is explicitly an interface schematic, not data.
`/explore` pairs a configured projection with GSV, an exact-record table,
missingness diagnostics, descriptive comparison and an evidence inspector.
The existing `/` Payload application, `/operations`, freight APIs and domain
analytics remain in place. This change does not migrate their state to ESM.

The frontend owns selection and presentation. ESM owns evidence and release
state; the workbench and specialist instruments own scientific execution.
The current ESM consumer is restricted to public fixture projections. No live
scientific service, general result importer, production dataset or public
execution permission is established by this integration.

## Deliberate publication configuration

Use Node 24 for the standalone TypeScript contract tests. Start Terminal using
its existing `npm ci` and `npm run dev` commands. Start the companion GSV build
with `npm ci` and `npm run dev -- --host 127.0.0.1`.

Set server-side configuration in Terminal's `.env.local`:

```env
NOTATION_PUBLIC_EXPLORER_ENABLED=1
NOTATION_ESM_ORIGIN=http://127.0.0.1:3001
NOTATION_GSV_EMBED_URL=http://127.0.0.1:5173/embed.html
NOTATION_PUBLIC_PROJECTION_SPEC='<exact JSON payload.projection-spec.v1>'
NOTATION_PUBLIC_PROJECTION_DIGEST=sha256:<exact full projection digest>
```

The JSON spec must name `PUBLIC_RULING`, the exact corpus/release, release and
manifest digests, the source snapshot digest, 1–128 explicit record IDs, knowledge
and valid instants, and `GLOBE / GEODETIC / GLOBAL_3D`. There is no `latest` alias.
Acquire source bindings through ESM's existing release descriptor endpoint;
review the complete preview and its rights before explicitly pinning publication.
The pin must come from that review, not from whatever an untrusted response says.
No real source IDs, private records or credentials are included in this repository.

The server POSTs only this configured spec to `/api/projections/preview` and
requires the fixture header, JSON type, a bounded body, and matching digests.
No visitor-supplied source URL, record selection, header or authorization token
is forwarded. Redirects are disabled and requests time out. The loader returns
no upstream error text. Missing or invalid configuration leaves the explorer
unavailable; it does not substitute demo data or guess a release.

Production endpoints require HTTPS. HTTP is accepted only for loopback
local development. Keep the viewer on a separately controlled origin and set
appropriate CSP/frame headers at deployment. Existing operational services
require their existing independent access controls; this page is not a security
boundary for all other routes in the application. No deployment was changed.

## Descriptive comparison, not a model run

Explicitly choose two current records. Comparison requires identical subject,
predicate, nonempty unit and measurement basis at the shared projection time.
No conversion, identity inference or automatic baseline selection is performed.
For supplied finite values `a` and `b`, the descriptive difference is `b - a`;
relative difference is `(b - a) / abs(a)` and is unavailable for a zero baseline.
Overflow also refuses rather than displaying infinity. The plot uses a shared
linear scale, not inferred confidence bars.

Input uncertainty declarations remain separate. Uncertainty of the difference
is unavailable without a declared joint uncertainty model. Independent-error
assumptions, calibrated covariance, significance and causality are not inferred.
Physical conservation and model-validity tests must arrive from instruments.

## Validation

```sh
node --test tests/explorer/*.node.mjs
node scripts/check-replacement-ledger.mjs
node scripts/check-gsv-contract.mjs
npm test
npx tsc --noEmit
npm run build
```

The GSV contract pin records the exact consumer revision and content hash. Its
CI check compares the mirror against that exact upstream file. Contract tests
use a hand-authored public test fixture; they do not establish a live ESM
integration. Full app checks and browser results are reported separately in CI.
