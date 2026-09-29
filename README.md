# Frame Mapper

**Map supplied system state into explicit spatial, temporal and relational representations.**

[Notation Systems](#notation-systems) · [Bounded workloads](#bounded-workloads-and-expertise-amplification) ·
[Run the application](#run-the-existing-application) ·
[Technical reference](TECHNICAL_REFERENCE.md) · [Security policy](SECURITY.md) ·
[Copyright and licence](#copyright-and-attribution)

## NET micro-tool

| Identity | Value |
| --- | --- |
| User-facing name | **Frame Mapper** |
| Proposed NET operation | `spatial.map` |
| Implementation repository | `Geospatial-Systems-Compiler` |
| Existing project identity | Geospatial Systems Compiler / GSC |
| Current scope | Existing browser inspection application; broader representation compilation and coordinate/frame adapters remain explicitly scoped integration work |

The friendly name describes the representation capability to expose through
[Notations Systems Terminal (NET)](https://github.com/giasonpooni/Notations-Systems-Terminal).
`spatial.map` is an interface target, **not a newly implemented terminal command
or a claim that arbitrary coordinate, Blender, Godot, Bevy or GIS conversions
already work**. Existing application routes and configuration remain unchanged.
The micro-tool does not replace GSC's broader representation responsibilities.

GSC is the representation and inspection project in Notation Systems. Its
existing browser application grew from Payload Terminal V0; the broader
compiler and cross-project handoffs remain explicitly scoped integration work.

## Notation Systems

[**Notation Systems**](https://notation.systems) develops evidence-backed
industrial intelligence, computational instrumentation and tooling for physical
systems. The purpose is to connect domain expertise, observations and declared
models to inspectable computation, justified decisions and bounded production
work. The service direction remains **verify → refresh → reconstruct** for an
agreed scope, not generic AI output or an assumed universal digital twin.

| Identity | Responsibility |
| --- | --- |
| **PAYLOAD** | Physical-economy and operational context: organizations, facilities, materials, shipments/custody and network dependencies; Caravan retains its movement/logistics interfaces. |
| **LANDSHARK** | Land, parcels, sites, ownership/use, access, development and spatial constraints. |
| **TRADEWIND** | Contracts, prices, commitments, exposure and physical-economic/market analysis. |
| **PayloadOS / ESM** | Governed industrial evidence, identity, state, admission and release responsibilities; not replaced by GSC or NET. |
| **Dossier Services** | Scoped service delivery and compilation of permitted customer-facing outputs. |
| **NET** | The shared programmable workbench/control plane; existing NET / `net` / `ciw` identities remain intact. |
| **Cartesian Graphics** | Notation Systems' games, graphics, physics and simulation studio/label; 1792 is primary, Garibaldi secondary, Geronimo on hold. |

Manufacturing, robotics, materials/chemistry, GIS/remote sensing, DSP, scientific
computing and analytics are engineering workload families, not additional public
product rooms or claims of completed integrations. The parent/studio relationship
does not assert a separately incorporated subsidiary.

**Shared primitives; separate state authority.** GSC remains an industrial
representation component, not a game engine. NET remains the shared workbench;
specialist repositories retain their mathematics, implementations and licences.
ESM retains evidence, admission and release authority. Game-owned simulation state
and clocks do not become industrial evidence through shared tools or parentage.
Evidence, operation, execution and verification identities remain distinct.

The work is by **[Giason Pooni](https://github.com/giasonpooni)**, with contributor
and upstream attribution retained. Each repository keeps its own implementation,
status and licence. Website publication and repository availability are separate;
a project link does not imply that a hosted demo or released game exists.

## Role, contribution and status

| Field | This project |
| --- | --- |
| Role | Frame/state representation tool backed by GSC's representation compilation and browser inspection work; portfolio category: **Tools**, with simulation applications. |
| Author's work | System design, application development, provenance-aware records, integration and inspection workflows built on credited foundations. |
| Technology | TypeScript, Next.js, React and MapLibre. |
| Status | Existing map-led physical-economy application; broader compiler, GSV/ESM and workbench integrations are not implied complete. |

## Bounded workloads and expertise amplification

GSC's contribution to the intended expertise-to-artifact workflow is **explicit
representation**, not automatic truth creation. A reviewed site, terrain or
historical-world specification can request a scoped transformation; it must
retain source identities, units, coordinate frames, clocks, uncertainty and the
difference between measurements, estimates and simulation. Oral accounts and
expert heuristics remain attributed inputs until the relevant domain reviews them.

NET coordinates the work; GSC owns its declared transformations; GSV projects
read-only; ESM admits industrial evidence under its own policy. A game's accepted
terrain or scene remains game-owned. Cross-domain composition requires compatible
versioned contracts, not a universal ontology or shared mutable world state.

General expertise capture, dependency-aware invalidation/rebuilds and bounded
agent execution are development targets. Logical domain containers and MCP tool
interfaces do not themselves establish OS isolation. Python, Julia, Rust and C++
providers are optional explicit bindings, not an automatic language translator
or a reason to replace this TypeScript implementation. Evaluate accepted,
integrated work against human effort, cost, rework and domain-specific quality;
no cross-domain productivity gain is asserted by this README.

## Portfolio, explorer and workbench

The intended **notation.systems public site is a thin, read-only organization
shell**, not an operational launcher or a game engine. GSV is its only interactive
globe and must remain visibly labelled `synthetic:demo`; GSC / Frame Mapper is a
repository link only. PAYLOAD, TRADEWIND and LANDSHARK remain text identities,
not operational launchers. Compiler servers, live providers, operational credentials,
NET operations and ESM admission do not belong in that public bundle. This README
documents the boundary; it does not deploy or alter the website.

GSC remains a separately scoped application. NET retains investigation and
execution history; specialist providers retain mathematical authority; ESM
retains its own evidence and release boundaries. A display or navigation link
does not authorize a computation or publish a private record.

The current application includes **write-capable freight APIs**. The intended
read-only demonstration/explorer boundary does **not** describe every existing
route. Public organization content must remain separate from authenticated
operations and operational credentials.

## Run the existing application

Use Node.js 22 and the [existing application instructions](TECHNICAL_REFERENCE.md#run-the-existing-application)
for setup, tests and deployment. These start the current application, not the
public organization site or a completed unified scientific workbench.

Existing package, `PAYLOAD_*` configuration, route, schema and retained-record
identities remain unchanged. The prior application title is historical context,
not a new parallel project.

## Technical reference

[TECHNICAL_REFERENCE.md](TECHNICAL_REFERENCE.md) preserves the complete previous
technical README verbatim, including configuration, route boundaries, collection
policy, origin, licensing and acceptance criteria. It stays at the repository
root to preserve relative link bases. This overview supersedes older user-facing
positioning, not implementation limitations or operational policies.

See also the [physical-economy design](docs/PHYSICAL_ECONOMY.md),
[architecture ledger](docs/ARCHITECTURE_LEDGER.md) and [deployment guide](DOCKER.md).

The existing collection-policy block is retained unchanged below.

<!-- collection-policy:begin -->
## Collection policy

Payload is being built for a firm that will hold carrier, driver and customer
personal information. What the application is allowed to collect is therefore
part of its design, not a footnote to it.

**Prohibited, and removed from this tree:** username enumeration across
platforms, breach-corpus lookup by email address, infostealer credential
corpora, phone-number research, and host or port scanning. These were present
in the upstream project this fork began from. They are deleted — code, routes,
UI and client libraries — rather than disabled or feature-flagged, because a
feature-flagged breach lookup is still a breach lookup in the tree and still
in the image.

**Conditional, and permitted only with the condition written down:** WHOIS,
DNS, IP intelligence, certificate transparency, BGP/ASN and MAC-prefix
lookup. Each states the same constraint in its own source —
*organisational infrastructure attribution only; never used to profile a
person*. A conditional permission with the condition left implicit is an
unconditional permission.

**Permitted:** sanctions screening of counterparty **organisations, vessels
and aircraft**. The person path is not served, and is filtered out of every
result set rather than merely omitted from the schema allowlist.

Three checks hold this in place, and they run in CI:

- the **source registry** refuses to register a source that yields
  natural-person data;
- the **route-surface gate**
  ([`routeSurfacePolicy.test.ts`](src/lib/economy/routeSurfacePolicy.test.ts))
  classifies every route under `src/app/api/**`, fails on an unclassified
  one, and scans every route's source for a prohibited capability regardless
  of how it is labelled;
- the **shipped-description gate** fails if this README advertises a
  prohibited capability — the description is an artifact and drifts from
  policy like any other.

Registration was never the only door.
<!-- collection-policy:end -->

## Copyright and attribution

**© 2026 Giason Pooni, for original contributions.** The Notation Systems parent
and Cartesian Graphics studio relationship does not claim ownership of inherited
code or third-party dependencies.

This project began as a fork of [simplifaisoul/osiris](https://github.com/simplifaisoul/osiris)
and retains its map/rendering foundation. The inherited MIT grant and notices
remain applicable to that code. The project-wide **GNU GPL v3.0** terms remain
in [LICENSE](LICENSE); contributor and dependency notices remain in force.
This documentation update does not relicense code or add an incompatible
blanket “all rights reserved” restriction.
