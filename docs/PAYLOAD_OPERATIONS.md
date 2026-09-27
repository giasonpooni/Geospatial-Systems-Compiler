# Existing Payload application and operations

The existing operating paths are retained. This guide preserves their setup and
freight configuration separately from the new visual explorer.

## Run Payload

These commands start the current Payload application, alongside the new
Notation Systems visual entry; it does not start a scientific workbench. Use Node.js 22
for consistency with the repository's container build.

```bash
git clone https://github.com/giasonpooni/Geospatial-Systems-Compiler.git
cd Geospatial-Systems-Compiler
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm test          # Vitest, including the policy gates
npx tsc --noEmit  # Type checking
npm run build    # Production build
```

For a README-only change, the relevant shipped-description checks are in:

```bash
npm test -- src/lib/economy/routeSurfacePolicy.test.ts
```

### Docker / self-hosting

Create an optional `.env` with the supported settings below. The current Compose
file expects an external network named `umami_default`; provision it first if
it does not already exist.

```bash
docker network inspect umami_default >/dev/null 2>&1 || docker network create umami_default
docker compose up -d --build
```

The image uses a multi-stage `node:22-alpine` standalone build and a non-root
application user. The container listens on `3000`; `PAYLOAD_PORT` controls the
published host port. Compose provisions a persistent freight-journal volume.
See [DOCKER.md](../DOCKER.md) for additional deployment details; some inherited
naming and setup references there still need alignment with this repository.

### Environment and freight operations

Some existing data paths use public, keyless sources; others need credentials
or return unavailable results. Keyless does not guarantee live availability.
Private freight commands require their own configuration and are not part of
the new public explorer.

Use the following settings as needed in `.env`. The checked-in
[`.env.example`](../.env.example) also contains legacy entries and comments; it is
not a declaration that all of those inherited capabilities are supported.

```env
# Published host port; container always listens on 3000
PAYLOAD_PORT=3000

# Force source snapshot fallback, visible in provenance
PAYLOAD_DISABLE_LIVE=

# Leave the operations token empty to disable the private operations API
PAYLOAD_OPERATIONS_TOKEN=
PAYLOAD_OPERATIONS_LOG=

# Carrier authority/status and weekly diesel benchmark
FMCSA_WEB_KEY=
EIA_API_KEY=
PAYLOAD_FREIGHT_SOURCE_TIMEOUT_MS=10000

# Outbound carrier adapter and authenticated inbound carrier events
PAYLOAD_CARRIER_DISPATCH_URL=
PAYLOAD_CARRIER_DISPATCH_TOKEN=
PAYLOAD_CARRIER_DISPATCH_PROVIDER=carrier-webhook
PAYLOAD_CARRIER_DISPATCH_TIMEOUT_MS=10000
PAYLOAD_CARRIER_WEBHOOK_SECRET=
PAYLOAD_CARRIER_COMMUNICATIONS_LOG=
```

`GET /api/freight/operations` reads current load-operation projections;
`POST /api/freight/operations` advances intake, alternatives, authorization,
assignment, dispatch evidence, and settlement outcome capture.
`GET /api/freight/control-tower` joins these records to tender delivery,
acknowledgements, tracking freshness, delivery windows, and settlement state.
The `/operations` workspace refreshes that private view every 30 seconds and
keeps its bearer credential only in the active browser tab's memory.

`GET /api/freight/sources?usdot=<number>&carrierId=<internal-id>&includeDiesel=1`
pulls FMCSA identity/authority/out-of-service evidence and the EIA weekly U.S.
diesel benchmark. It returns an `authorizationCarrier` object but leaves cargo
insurance expiry and limit null: missing coverage never becomes clearance.

`POST /api/freight/communications` delivers the journal-derived tender to the
configured carrier adapter with a stable `Idempotency-Key`; its corresponding
`GET` exposes delivery and carrier-event projections. These private routes
require `Authorization: Bearer <PAYLOAD_OPERATIONS_TOKEN>`.

The carrier adapter must return JSON containing `receiptId` and optionally
`acceptedAt`. It receives only the selected carrier rate and sanitized load
facts—not the shipper target rate or source-message identity. Carriers post
acknowledgements and tracking updates to `/api/freight/carrier-events`, signed
as `HMAC-SHA256(timestamp + "." + rawBody)` using
`PAYLOAD_CARRIER_WEBHOOK_SECRET` (at least 32 random bytes). Run both journals
on persistent, backed-up storage with one application writer.

FMCSA and EIA keys stay server-side and are not included in evidence identifiers
or source errors. Partial upstream failure returns a typed source refusal, not
an inferred compliance pass. Do not expose operational credentials in public
site configuration, demonstration artifacts, or navigation links.

> **Compatibility:** existing `PAYLOAD_*` settings and Payload identifiers
> remain in use. The documented `OSIRIS_*` migration aliases are temporary;
> the existing compatibility window ends after `v0.2.0`. This integration
> does not rename packages, environment variables, routes, or retained records.
>
> `SCANNER_URL` and `SCANNER_KEY` refer to a removed backend. Do not configure
> them even where inherited setup examples still contain those entries.

