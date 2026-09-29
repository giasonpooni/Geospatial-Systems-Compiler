# Notation Systems — read-only homepage

A small static organization homepage, with the **existing Geospatial State
Visualization (GSV) production client** as its only interactive globe. It is
not a GSC application route and does not deploy the compiler's Next server.

**Public artifact: `homepage/dist/` only.** Never publish the repository root,
GSC's `.next` output, or its Docker image as this homepage.

## What visitors see

An organization strip, the synthetic geographic exhibit, a compact stack table,
and source/policy links. PAYLOAD, TRADEWIND and LANDSHARK are text identities,
not launch buttons. The shell works without JavaScript; the globe requires
JavaScript and WebGL. Both the sticky shell label and the original GSV status
chip identify the snapshot as synthetic.

The shell contains no JavaScript, forms, tracking, lookup, credentials, or
command bridge. GSV's existing commands change only local presentation. The
homepage does not retain canonical evidence, admit state, execute science,
or connect cross-repository adapters.

## Independent build

Use **Node.js 24 or newer**, Git, and npm. Run the following from this
repository's root, with the GSV checkout outside it:

```sh
git clone https://github.com/giasonpooni/Geospatial-State-Visualization.git ../gsv-homepage
git -C ../gsv-homepage checkout 6f1b339dfa103bc45b40f34170043bc23a010c57
(cd ../gsv-homepage && npm ci)
node --test homepage/tests/boundary.test.mjs
node homepage/scripts/build.mjs --gsv ../gsv-homepage
node homepage/scripts/serve.mjs homepage/dist 4173
```

Open the local preview at `http://127.0.0.1:4173`. The preview server is a
loopback-only development/test utility and is **not in the public bundle**.
It permits GET/HEAD, returns 404 for absent paths, and has no API handlers or
SPA fallback. Do not run GSC's root `npm install`, `npm run build`, or server
for this build.

`gsv.lock.json` selects one reviewed, immutable upstream commit. The builder
requires a clean, separately checked-out source tree matching that pin. It
runs GSV's original `npm run build`, which includes its seam, provenance,
provider/immutable replacement regressions, and TypeScript checks. No GSV
source files, package identities, or original status-chip styles are changed.

After those checks, an additional gate executes the actual synthetic dataset
and requires **every domain record** to have `provenance.source =
'synthetic:demo'`. It rejects missing, mixed, or empty domain data. Only the
expected static Vite assets and the two bundled background topology files
may enter the exhibit. Those geography files are background cartography;
they are not a separately released public-official industrial data pack.

The builder removes external Google Fonts links from **built HTML only**,
retains existing local fallback fonts, and adds restrictive browser policies.
No new font files or third-party resources are distributed. The original GSV
controls, inspector, synthetic chip, `payload-earth`, `window.payloadEarth`,
and `payload:spatial` identities remain intact.

## Deployment boundary

Serve only `homepage/dist/` from a dedicated static origin. This directory
contains the homepage, GSV exhibit, notices, corresponding source archives,
and a build manifest with source pins and file SHA-256 digests. Source
archives contain only the public GSV source and this homepage's build inputs,
not the compiler application. They are downloadable files, not server code.

The artifact has no executable server, API routes, environment configuration,
economy exporter, operator credentials, ESM store, or NET runtime. Build
subprocesses receive a small environment allowlist rather than PAYLOAD,
VITE, or operator variables. `.env` files in the GSV checkout are rejected.
GSC is a repository link, not a runtime dependency.

Apply the shipped `_headers` policies on hosts that support that format;
equivalent CSP meta tags also travel with the two HTML entrypoints. Configure
other hosts to serve static files only, reject non-read methods, return real
404s for absent paths, and **never proxy or rewrite to GSC**. In particular,
`/api/economy`, `/api/freight`, `/operations`, and `spatial.map` must not reach
an operational upstream. Host configuration and domain routing are separate
from producing a safe artifact and require verification after deployment.

The same-origin iframe permits scripts and origin access for the existing
module client. Its sandbox is not a boundary against malicious same-origin
code. The meaningful boundaries here are the pinned reviewed build, no
parent bridge, static-only deployment, and absence of any operational
upstream or credential. The parent cannot make network connections under
its CSP; the exhibit can read same-origin static assets. These policies are
not a substitute for correct hosting configuration.

The older Next `/notation` / `/explore` proposal is not the deployment path
for this brief. This folder is independently packaged while the compiler
remains separately operated. No hostname, DNS record, live Webflow page,
or existing operational deployment is changed by this build.

## Acceptance and evidence

`.github/workflows/notation-homepage.yml` runs only the standalone homepage
build, with Node 24 and a separate pinned GSV checkout. It does not install
or start the compiler. It uploads the static artifact and browser evidence;
it does not automatically deploy or change a domain.

The browser acceptance test loads the **real production GSV** at desktop and
mobile sizes, checks the original synthetic chip, exercises `/` and all four
published command hints, verifies the immutable snapshot is unchanged, and
rejects third-party or write requests. It also checks the JavaScript-disabled
shell and absent operational routes. The pure boundary tests cover malicious
or accidental file/copy/provenance regressions. Test fixtures never enter the
public artifact.

To repeat the browser acceptance, install the pinned test tooling outside
both source trees and set `PLAYWRIGHT_MODULE` to its `playwright/index.mjs`:

```sh
npm install --prefix /tmp/notation-browser --ignore-scripts --no-audit --no-fund playwright@1.55.1
node /tmp/notation-browser/node_modules/playwright/cli.js install --with-deps chromium
PLAYWRIGHT_MODULE=/tmp/notation-browser/node_modules/playwright/index.mjs node homepage/tests/browser-smoke.mjs
```

Read `homepage/evidence/browser-report.json` and its screenshots, plus the
homepage workflow's GSV check/build log. A successful local/CI artifact test
does not by itself prove that an existing public hostname has been migrated.

## Collection scope and license

No natural-person profiling or dossiers; no phones, MAIDs, ad-tech location,
breach corpora, host/port scanning, or intelligence lookup. No person path on
this public surface. There is no sanctions feature. There is no live provider.

Author: **Giason Pooni**. The homepage and shown tools use **GPL-3.0**; see the
repository `LICENSE`, shipped notice, and corresponding source archives.
