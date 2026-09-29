# Notation Systems — read-only homepage

A static organization homepage with the existing **Geospatial State
Visualization (GSV)** production client as its only interactive globe.

**Publish `homepage/dist/` only.** This is not a GSC application route. Do not
publish the repository root, `.next`, or the compiler's Docker image as this
homepage. The older Next `/notation` and `/explore` proposal is not used.

## The page

Organization → synthetic exhibit → responsibility table → sources and policy.
PAYLOAD, TRADEWIND and LANDSHARK are text identities, not launch buttons. The
shell has no JavaScript, forms, tracking, lookup or command bridge. It remains
readable without JavaScript; the globe requires JavaScript and WebGL.

The sticky shell label and original GSV chip both disclose synthetic data.
GSV projects a validated immutable snapshot. It does not admit evidence,
retain canonical corpora, operate investigations, or connect live adapters.

## Build and preview

Use **Node.js 24+**, Git and npm. From this repository's root:

```sh
git clone https://github.com/giasonpooni/Geospatial-State-Visualization.git ../gsv-homepage
GSV_COMMIT=$(node -p "require('./homepage/gsv.lock.json').commit")
git -C ../gsv-homepage checkout "$GSV_COMMIT"
(cd ../gsv-homepage && npm ci)
node --test homepage/tests/boundary.test.mjs
node homepage/scripts/build.mjs --gsv ../gsv-homepage
node homepage/scripts/serve.mjs homepage/dist 4173
```

Open `http://127.0.0.1:4173`. The preview utility binds only to loopback,
permits GET/HEAD and returns actual 404s for missing/API paths. It is not in
the public artifact. Do not install or start the parent GSC application.

The two repositories must be separate filesystem siblings, not nested:
Vite/PostCSS can otherwise discover GSC configuration in a parent folder.
Both sets of build inputs must match their committed corresponding source.
The full GSV commit is pinned in `gsv.lock.json`, never a moving branch.

## Exhibit boundary

The builder runs the original GSV `npm run build`, including `npm run check`:
seams, provenance, provider/immutable replacement regressions and TypeScript.
An additional gate evaluates the actual synthetic dataset and requires every
domain record to have `provenance.source = 'synthetic:demo'`. Missing, mixed,
nested non-synthetic and empty domain data refuse packaging.

Only expected Vite assets and the two existing background topology files
enter the exhibit. Background geography is not an official industrial data
pack. No live provider or exporter is implemented. Compatibility identities
`payload-earth`, `window.payloadEarth` and `payload:spatial` remain intact.

The pinned GSV revision includes a small additive responsive HUD stylesheet.
Production browser testing found that the original chip overflowed a 390px
viewport. The fix wraps the metrics and controls, prioritizes the original
chip and separates the timeline. It does not change provider, store,
renderer, command implementations, chip wording, warning colors or type.
See the corresponding source archive and GSV's responsive-exhibit notes.

Packaging removes external Google Fonts links from built HTML only and adds
restrictive policies. No font files, credentials, backend, API handlers,
ESM store or NET runtime are included. Build subprocesses receive a small
environment allowlist; `.env` files in the GSV checkout are refused.

## Static deployment

Use a dedicated static origin with **no operational upstream**. Upload only
`homepage/dist/`, retain the directory structure, allow GET/HEAD, and return
404 for missing paths. Never proxy or rewrite `/api/economy`, `/api/freight`,
`/operations` or `spatial.map` to GSC. Do not configure an SPA fallback.

Apply `_headers` on compatible hosts or equivalent host policies; both HTML
entrypoints also carry CSP meta tags. The shell cannot make network requests;
the exhibit can read same-origin static files. The iframe's same-origin
sandbox is not protection against malicious same-origin code. The meaningful
boundaries are the reviewed pin, static-only bundle, no bridge or credentials,
and hosting with no compiler upstream. Host routing must be verified after
publication; passing artifact tests does not establish a domain cutover.

No DNS, existing domain, live Webflow page or operational deployment is
changed by this workflow. It produces artifacts, not an automatic deployment.

## Tests and retained evidence

`.github/workflows/notation-homepage.yml` uses Node 24 and sibling checkouts,
without installing or starting GSC. It runs 19 homepage boundary regressions,
the original GSV suite and production build, then actual Chromium acceptance
at 1440, 768, 390 and 320px widths. Checks cover the original chip and control
bounds, all four command hints, unchanged immutable synthetic data, local-only
read requests, missing operational routes and a JavaScript-disabled shell.

`homepage/evidence/` holds screenshots, the browser report and dependency
audit reports. Development-tool advisories are recorded without upgrading the
upstream lockfile; the production-only audit is checked separately. A failed
browser build is retained for two days as explicitly non-release diagnostics.
Only a passing run produces the approved `notation-static-homepage` artifact.

For local browser acceptance, install Playwright outside both repositories:

```sh
npm install --prefix /tmp/notation-browser --ignore-scripts --no-audit --no-fund playwright@1.55.1
node /tmp/notation-browser/node_modules/playwright/cli.js install --with-deps chromium
PLAYWRIGHT_MODULE=/tmp/notation-browser/node_modules/playwright/index.mjs node homepage/tests/browser-smoke.mjs
```

## Scope, source and notices

No natural-person profiling or dossiers; no phones, MAIDs, ad-tech location,
breach corpora, host/port scanning or intelligence lookup. No person path on
this public surface. No sanctions feature or live provider is added.

Author: **Giason Pooni**. Homepage and shown tools: **GPL-3.0**. The artifact
includes the GPL notice, bundled dependency notices, corresponding source
archives and a manifest with source commits and SHA-256 file digests. Source
archives contain only public GSV source and this homepage's build inputs,
not the compiler application. They are static downloads, not server code.
