# Commercial preflight integration and limits

## Implemented here

`src/lib/commercial/catalog.ts` is the single source for the three public product
cards at `/products`. It contains no production grant, numeric posted rate,
checkout or service-level promise.

`src/lib/commercial/admission.ts` exports three pure, deterministic checks:

| Check | What a qualified result means | What it does not mean |
| --- | --- | --- |
| `qualifyDelivery(request, grants, at)` | The supplied current rights evidence matches every declared source, customer, exact scope, delivery type and instant | Authentication, complete-lineage verification, legal review, or delivery authorisation by itself |
| `qualifySeatValue(evidence, at)` | A trusted operator's summary meets the separate demand and USD value test | Receipt verification, the original maintenance verdict, or a validated annual rate |
| `qualifyWatch(order, measuredCapacity, objectRegister)` | A bounded order matches a supplied resolved register and measured limits | Live monitoring, scheduling, persistence, a scale benchmark, or source-rights approval |

Every refusal includes a code, path and remedy. UTC validity windows are
[start, expiry); expired-at-this-instant refuses. Scope matching is exact, without
wildcards. Source grants are selected from an active registry with **one current
record per source/customer**: retain history privately, but pass only the current
reviewed record, including a revocation when applicable. Ambiguity refuses rather
than picking the most permissive record.

## Integration before any paid delivery

This patch does **not** wrap existing export or freight API handlers, introduce
billing, or alter middleware. A library helper cannot honestly be described as a
global commercial delivery gate. A future authenticated service must do all of:

1. Authenticate the organisation and enforce tenant-bound entitlements. Derive the
   contracted SKU, scope and purpose from the server-held order, not browser input.
2. Run the existing source/collection gates. Obtain complete transitive source
   lineage from the trusted producer's retained output. Bind it to the exact
   payload/vintage being delivered; caller-selected `sourceIds` are insufficient.
3. Load the current privately reviewed grant registry. Verify actual terms and
   evidence outside this pure helper; a string `reviewRef` is not a signature.
   Re-evaluate at delivery time, not just at quote time. Deny the delivery when any
   gate refuses; a refusal payload must itself respect source permissions.
4. For watches, bind the object-register snapshot and exact object set to the
   retained portfolio scope. Derive subject kinds from that register and enforce
   the organisation/vessel/aircraft restriction when the purpose is sanctions.
   Run **both** delivery-rights and watch qualification; neither substitutes for
   the other. Keep source outages and delivery failures visible.
5. Preserve valueKind, quantity basis, attribution basis, source, vintage,
   knowledge time, input identities, uncertainty and refusals in every delivered
   memo/feed/alert. Log the actual delivery durably and append corrections.

Do not expose the grant records, trial logs or customer registers in public
fixtures, browser bundles or this repository. Account/session evidence belongs in
a private operating system, not in the market-data product. Fixtures in the tests
are explicitly synthetic and do not prove that any provider granted rights.

## Tests and evidence

The normal `npm test` command discovers `commercial.test.ts` through Vitest.
`npm run test:commercial` runs an isolated offline harness: TypeScript strictly
compiles the two production modules, then runs the **same assertions** with only
the `describe`/`it` import adapted from Vitest to Node's built-in test runner.
No assertions or dependencies under test are mocked by that adaptation.

The focused run is not a full Next.js build, route-policy run, browser check or
load test. Those remain repository/CI checks. The original 90-day continue
criterion, source adapters, canonical records, archived evidence, software
licences, default branch and deployment are not changed by these helpers.
