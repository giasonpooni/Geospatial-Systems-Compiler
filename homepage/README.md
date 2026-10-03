# Notation Systems — exhibition homepage

**One globe. Notation Systems at the upper left; About, Contact and Tools at the upper
right; legal links centered along the bottom.** Company information is in
closable, same-page windows, not a long landing page or repository census.

Publish **`homepage/dist/` only**, never GSC's repository root, Next server,
`.next` directory or Docker image. This remains an independently built static
homepage. No operational compiler, evidence store, backend, live provider or
canonical write path is included.

## Presentation

The homepage embeds the existing GSV production client with the explicit
`?presentation=exhibit` view option. Geographic contours are rendered on the
existing sphere in a square viewport: no horizontal/vertical stretching and no
new renderer. The original generalized cartography and schematic textures are
retained. This is not a survey-grade ellipsoid, literal physical 1:1 Earth,
satellite photograph, or connected digital twin.

At arrival, thematic overlays, automatic rotation and dashboard panels are off.
Drag and wheel remain available; `/` inside the frame reveals the existing view
commands and Escape puts the controls away. The original synthetic-data warning
chip remains visible and unchanged. The ordinary `/exhibit/` inspection view is
still available. No domain record or provider is changed by the presentation.

About holds the firm's purpose, three domains and four crafts. Contact uses the
email displayed on the existing company Contact page, with a `mailto:` link;
no form is copied, submitted or stored by this page. The email's delivery has not
been tested. Neither placeholder phone numbers nor template addresses are used.

## Company windows

A small, locally served `windows.js` module opens native HTML dialogs. About,
Contact, Tools and Licences each have a labelled top-right × control, Escape dismissal,
keyboard focus containment and focus return. The underlying globe is inert
while a modal is open and is not reloaded when it closes. Without JavaScript,
same-document anchors and a `:target` fallback expose the same content and close
controls; those fallback windows are not represented as native modal dialogs.

This intentionally extends the earlier zero-script shell with **one UI-only
module**. CSP permits that local script while keeping `connect-src 'none'`.
The module has no network, storage, forms, message bridge or frame access.

## Tools → Notations Terminal

### Research context for portfolio readers

The [Frame Mapper overview](../README.md#net-micro-tool) identifies the
representation and inspection scope. NET's
[research README](https://github.com/giasonpooni/Notations-Systems-Terminal/blob/docs/research-whitepaper-foundations-20260929/README.md)
and [mathematical review note](https://github.com/giasonpooni/Notations-Systems-Terminal/blob/docs/research-whitepaper-foundations-20260929/docs/REPRESENTATION_PROBLEM.md)
provide the formal objects, an implemented finite counterexample and open
questions for mathematical review. Both links point to an **unmerged
documentation branch**; the finite checker is in a separately identified
draft NET increment.

The portfolio distinguishes representation, transformation, information loss
and verification. A rendered globe or a matching aggregate is an inspection
surface, not evidence of general invariant preservation. These links are
documentation for reviewing the project; the homepage build still contains no
NET runtime or scientific verification service.

### Existing local workbench guidance

The top-right navigation is **About · Contact · Tools**, in that order. Tools
opens a same-page **Notations Terminal** window through the existing dialog
controller, with the same ×, Escape and keyboard-focus behavior.

The current NET deployment guide documents a local workbench, not a hosted
browser launch endpoint. The window states this explicitly, shows the existing
PowerShell Setup/Start/Status commands, and links to the real NET installation
and deployment guide. It is not a terminal emulator, a connected session, or an
installer. The user runs those commands locally; a webpage click does not execute
them. The external guide opens with `noopener noreferrer`.

No invented `/terminal` route, localhost probe, WebSocket bridge, custom URI
handler or NET backend is included. A direct launch of a running hosted NET
still requires its separately deployed, authenticated URL; no URL is guessed
from the repository name. This change adds the navigation and honest launch
window, **not a working browser-hosted Terminal**. Keep the public homepage and
the operational workbench separate. No terminal repository files are modified.

## Legal links and publication

Privacy and Terms link to the existing company document destinations:
`https://notation.systems/privacy-policy` and
`https://notation.systems/terms-of-service`. These documents are **not rewritten
or bundled** in this revision. The centered Licences window links to bundled
GPL/third-party notices and corresponding source archives.

Those existing Webflow legal documents still contain template-era statements
and mailto targets inconsistent with their displayed addresses. They require a
separate review; this design change does not silently amend an existing policy.
Preserve or intentionally migrate the existing legal routes before a hostname
cutover. Deploying this artifact alone at `/` does not create those legal paths.
No Webflow publication, DNS change or domain cutover is performed by this build.

## Independent build

Use **Node.js 24+**, Git and npm. Keep the source repositories as filesystem
siblings so Vite does not discover GSC's PostCSS configuration in an ancestor.
From this repository root:

```sh
git clone https://github.com/giasonpooni/Geospatial-State-Visualization.git ../gsv-homepage
GSV_COMMIT=$(node -p "require('./homepage/gsv.lock.json').commit")
git -C ../gsv-homepage checkout "$GSV_COMMIT"
(cd ../gsv-homepage && npm ci)
node --test homepage/tests/boundary.test.mjs
node homepage/scripts/build.mjs --gsv ../gsv-homepage
node homepage/scripts/serve.mjs homepage/dist 4173
```

Both trees must match committed build inputs and the full immutable GSV pin.
The builder runs GSV's original `npm run build` / `npm run check`, validates the
actual synthetic dataset, and packages only eligible static files. The shell
and GSV remain separate packages; the compiler is never installed or started.
Build subprocesses receive a small environment allowlist, not operator values.

Only expected Vite assets and the existing two background topology files enter
the exhibit. Every domain record must retain `provenance.source='synthetic:demo'`.
Remote font links are removed from built HTML only; no font files are shipped.
The original seam and immutable-snapshot tests remain mandatory. Package/browser
identities `payload-earth`, `window.payloadEarth`, and `payload:spatial` remain.

## Acceptance

The homepage workflow uses Node 24, separate GSV source, provenance and boundary
regressions, the original GSV test/build sequence, and real Chromium testing.
It checks desktop, tablet, phone and landscape exhibition viewports, square
rendering, header/footer geometry, synthetic chip, native dialog X/Escape/focus (including Tools),
no iframe reload, drag/zoom, immutable state, four view-command hints, retained
full inspection, and usable no-JavaScript windows. Resource requests must stay
local and read-only. Operational routes return actual 404s; writes return 405.

A local browser run uses isolated Playwright tooling, not a shipped dependency:

```sh
npm install --prefix /tmp/notation-browser --ignore-scripts --no-audit --no-fund playwright@1.55.1
node /tmp/notation-browser/node_modules/playwright/cli.js install --with-deps chromium
PLAYWRIGHT_MODULE=/tmp/notation-browser/node_modules/playwright/index.mjs node homepage/tests/browser-smoke.mjs
```

Artifacts retain screenshots, source/build pins, per-file SHA-256 hashes,
commands, UI checks and dependency-audit results. A passing build is not a live
site migration. The preview utility is loopback-only and is not in the bundle.

## Host and source boundary

Use a static origin without an operational upstream. Apply `_headers` or
host-equivalent browser policies; both HTML entrypoints carry CSP meta tags.
Never proxy `/api/economy`, `/api/freight`, `/operations` or `spatial.map` to GSC;
do not add an SPA fallback. The same-origin iframe sandbox is not isolation from
malicious same-origin code: reviewed source, absence of credentials/bridges and
correct static hosting are the meaningful boundaries.

No person path. Author: **Giason Pooni**. Homepage and shown tools: **GPL-3.0**,
with third-party notices and scoped corresponding source retained. The firm's
public domains are PAYLOAD, TRADEWIND and LANDSHARK; games and internal plant do
not become homepage products.

