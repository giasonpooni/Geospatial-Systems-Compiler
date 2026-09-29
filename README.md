# Notations FrameMapper

**Inspect spatial and temporal system representations while keeping source and entity context visible.**

[Run](#run-the-existing-application) · [Technical reference](TECHNICAL_REFERENCE.md) · [Research profile](#bounded-workloads-and-expertise-amplification) · [Security policy](SECURITY.md) · [Licence](LICENSE)

## NET micro-tool

| Identity | Value |
| --- | --- |
| User-facing name | **FrameMapper** |
| Proposed NET operation | `spatial.map` |
| Current repository | `Notations-FrameMapper-RunTime` |
| Existing project identity | Geospatial Systems Compiler / GSC |
| Current scope | Browser inspection application; broader representation compilation and frame adapters remain scoped integration work |

`spatial.map` is an interface target, **not a newly installed Terminal command or proof that arbitrary coordinate, GIS, Blender or game-engine conversions work**. The existing browser application grew from Payload Terminal V0. Its route, package and configuration identities remain unchanged.

## Notation Systems

**Frontier Tooling and Instrumentation for Digital Futures.** Notation Systems develops computational instruments and operational tooling that connect scientific methods, specialized computation and human expertise.

PAYLOAD and Caravan retain physical-economy/logistics roles; LANDSHARK retains land/site context; TRADEWIND retains contract, price and exposure analysis. PayloadOS/ESM govern industrial evidence and state; Dossier Services packages permitted outputs. These are domain responsibilities, not newly deployed services.

[Notations Systems Terminal](https://github.com/giasonpooni/Notations-Systems-Terminal) is the shared workbench. **Cartesian Graphics** develops interactive worlds, simulation technology and digital IP: 1792 primary, Hero of the Two Worlds secondary, Geronimo on hold. Public-interest tooling and private creative work do not themselves establish nonprofit status, transfer rights or merge state authority. [Public profile](https://github.com/giasonpooni/Notations-Systems-Terminal/blob/b41b84922d4963a9206202029afd1e78b9451f9c/PUBLIC_POSITIONING.md).

## Role, contribution and status

An existing TypeScript/Next.js/React/MapLibre application with provenance-aware records and inspection workflows built on credited foundations. General compiler, coordinate and cross-repository handoffs must be qualified individually. GSC is not a game engine or a second scientific runtime.

Original contributions include system design, application development, representation and integration work. Specialist providers retain their mathematics; ESM retains admission/release authority; games retain live state, clocks and creative approval.

## Bounded workloads and expertise amplification

**Research question:** what identity, spatial, temporal and provenance information must survive a representation transformation? A useful comparison tests preserved queries, frame/unit mistakes, stale source versions and loss of relevant context—not just visual resemblance.

The wider programme builds instruments while testing their composition. NISE can propose relevant structure; FrameMapper's role is explicit representation, not automatic truth creation. A valid adapter needs declared semantics and reference tests. Python, Julia, Rust and C++ are possible external providers, not reasons to rewrite this TypeScript application or claim universal translation.

Measure task fidelity, transfer effort, runtime, memory and human review under fixed conditions. CUDA, automatic telemetry and provably minimum representations are not added by this documentation. [Research protocol](https://github.com/giasonpooni/Notations-Systems-Terminal/blob/b41b84922d4963a9206202029afd1e78b9451f9c/RESEARCH_PROGRAMME.md).

## Portfolio, explorer and workbench

The intended **notation.systems public site is a thin, read-only organization
shell**, not an operational launcher or a game engine. GSV is its only interactive
globe and must remain visibly labelled `synthetic:demo`; GSC / FrameMapper is a
repository link only. PAYLOAD, TRADEWIND and LANDSHARK remain text identities,
not operational launchers. Compiler servers, live providers, operational credentials,
NET operations and ESM admission do not belong in that public bundle. This README
documents the boundary; it does not deploy or alter the website.

GSC remains a separately scoped application. A display link neither authorizes
computation nor publishes a private record. The intended hosted Terminal at
`notations.io` is a separate service direction, not a deployment claim here.

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

[TECHNICAL_REFERENCE.md](TECHNICAL_REFERENCE.md) preserves the complete prior
technical README verbatim, including configuration, route boundaries, collection
policy, origin, licensing and acceptance criteria. It remains unchanged at the
repository root, preserving relative link bases.

See the [physical-economy design](docs/PHYSICAL_ECONOMY.md), [architecture ledger](docs/ARCHITECTURE_LEDGER.md) and [deployment guide](DOCKER.md). This documentation changes no source, workflow, licence or deployment and claims no new runtime or browser qualification.

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

**© 2026 Giason Pooni, for original contributions.** The Notation Systems and Cartesian Graphics relationship does not claim ownership of inherited code or third-party dependencies.

This project began as a fork of [simplifaisoul/osiris](https://github.com/simplifaisoul/osiris) and retains its map/rendering foundation. The inherited MIT grant and notices remain applicable to that code. The project-wide **GNU GPL v3.0** terms remain in [LICENSE](LICENSE); contributor and dependency notices remain in force. This documentation does not relicense code or add an incompatible blanket restriction.
