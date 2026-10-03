# Inspect native mean and covariance results

The new `/numerics` page accepts a local retained numerical-view JSON file and
an expected SHA-256 from a separately trusted artifact record. It supports the
existing mean-only envelope and the new covariance envelope. The file is read
in the browser; this page makes no upload, solver or state-admission request.
Changing the file or expected digest invalidates the displayed result, including
an inspection still awaiting an asynchronous hash.

The page shows baseline, change and value with explicit units/frame, full
covariance including cross terms, and separate model, calculation, execution,
result, runtime, covariance and verification identities. It does not invent
map coordinates, confidence intervals, Gaussian assumptions or calibration.
The original mean-only reader and claim remain unchanged.

The TypeScript uncertainty reader checks the exact UTF-8 payload bytes against
the external digest, then validates schema, identifiers, finite dimensions and
nonnegative diagonal entries. It binds covariance axis order, units and frame
to the nested mean view and freezes the returned detached matrix. The trusted
outer digest binds the nested envelope's digest; a free-standing self-digest
is not treated as an independently selected reference.

This is an integrity/representation reader, not an independent PSD or rational
covariance verifier. Complete covariance numerical validation and the separate
rational reference belong to the Terminal. A forged but consistently rehashed
view is not authenticated unless its expected digest came from a trusted record.
The full native run remains the audit artifact; this page displays a projection.

The companion contract is [Terminal covariance propagation](https://github.com/giasonpooni/Notations-Engineering-Terminal/blob/8782bee2a83087cf66d325e0b4b42a4fe5b04cdb/docs/POLYGLOT_UNCERTAINTY.md).
It computes J C J^T by composing the existing SCR/Rust-supervised C++ or Julia
profile. No native executable, private source or runtime binding is embedded in
GSC. Domain-owned exporters cover bounded BIM belief, shared curved-path heading
and pre-correction fluid balance uncertainty without transferring state authority.

## Check and serve

```sh
node scripts/check-polyglot-view.mjs
npm run build
npx playwright install chromium
node validation/numerics-browser.mjs
npm run start
```

Open `/numerics` on the local server. The browser harness starts and stops its
own loopback Next server and uses explicitly labelled parser/UI fixtures. It
checks full covariance, cross terms, digest invalidation/refusal, legacy mean-only
support, a 700px viewport and page errors. Those UI fixtures are not evidence of
native execution. Native qualification is a separate Terminal/SCR gate.

This adds an actual standalone inspection route, not public hosting, an artifact
service, a shared selection bus or a remote execution endpoint. Existing routes,
ESM/GSV integrations and public/private deployment policies remain unchanged.
