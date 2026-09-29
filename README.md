# Frame Mapper

**Map supplied system state into explicit spatial, temporal and relational representations.**

[Portfolio](https://notation.systems) · [Run the application](#run-the-existing-application) ·
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
[Notations Engineering Terminal (NET)](https://github.com/giasonpooni/Notations-Engineering-Terminal).
`spatial.map` is an interface target, **not a newly implemented terminal command
or a claim that arbitrary coordinate, Blender, Godot, Bevy or GIS conversions
already work**. Existing application routes and configuration remain unchanged.
The micro-tool does not replace GSC's broader representation responsibilities.

GSC is the representation and inspection project in Notation Systems. Its
existing browser application grew from Payload Terminal V0; the broader
compiler and cross-project handoffs remain explicitly scoped integration work.

## Notation Systems

[notation.systems](https://notation.systems) is the portfolio umbrella for
independent computational systems, simulation and interactive-software projects
by **[Giason Pooni](https://github.com/giasonpooni)**. The website presents the
work; each repository retains its own implementation, status and licence.

Portfolio areas: **Games & Interactive · Simulation · Tools · Research · About**.
Website publication and repository availability are separate; a project link
does not imply that a hosted demo or released game exists.

## Role, contribution and status

| Field | This project |
| --- | --- |
| Role | Frame/state representation tool backed by GSC's representation compilation and browser inspection work; portfolio category: **Tools**, with simulation applications. |
| Author's work | System design, application development, provenance-aware records, integration and inspection workflows built on credited foundations. |
| Technology | TypeScript, Next.js, React and MapLibre. |
| Status | Existing map-led physical-economy application; broader compiler, GSV/ESM and workbench integrations are not implied complete. |

## Portfolio, explorer and workbench

**notation.systems is the independent portfolio container**, not an instruction
to turn GSC into a game engine or place the entire portfolio inside a map.
Project pages should expose work, status, contributions, source and useful
technical explanations before the underlying architecture.

GSC remains a separately scoped application. NET retains investigation and
execution history; specialist providers retain mathematical authority; ESM
retains its own evidence and release boundaries. A display or navigation link
does not authorize a computation or publish a private record.

The current application includes **write-capable freight APIs**. The intended
read-only demonstration/explorer boundary does **not** describe every existing
route. Public portfolio content must remain separate from authenticated
operations and operational credentials.

## Commercial physical-economy products

The commercial packaging is **Seat / Feed / Watch**, separate from Frame Mapper's
NET operation. Open `/products` in the application for the qualification-stage
product cards, or read the [commercial guide](docs/commercial/README.md).

| Product | Scope | Current commercial status |
| --- | --- | --- |
| **Seat** | One commodity or corridor; evidence that survives memo export | Non-builder demand and value validation required |
| **Feed** | Licensed commodity, corridor or regional delivery with source vintages | Source/customer/use-specific rights and delivery qualification required |
| **Watch** | A versioned customer set of resolved industrial objects | Source rights, measured capacity, coverage and notification qualification required |

There is no validated annual seat rate, production grant registry, checkout or
live monitoring service added by this change. Research access is not permission
to redistribute. Provenance, value kind, quantity basis, control versus economic
interest and explicit refusals are part of the product, not optional extras.

The [preflight helpers and integration limits](docs/commercial/INTEGRATION.md)
separate source rights, seat-value evidence and bounded watch qualification.
They do not replace authentication or the existing collection and route gates.
The [procurement specifications](docs/commercial/PROCUREMENT.md) define three
separate order schedules, support hours and ceiling/draw-down requirements.
The pre-registered [continue criterion](docs/CONTINUE_CRITERION.md) is unchanged.

Design note: [industrial pipe and Pipe 1 boundaries](docs/INDUSTRIAL_PIPE.md).

## Run the existing application

Use Node.js 22 and the [existing application instructions](TECHNICAL_REFERENCE.md#run-the-existing-application)
for setup, tests and deployment. These start the current application, not the
new portfolio site or a completed unified scientific workbench.

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

**© 2026 Giason Pooni, for original contributions.** Notation Systems is the
independent project umbrella. This attribution does not claim ownership of
inherited code or third-party dependencies.

This project began as a fork of [simplifaisoul/osiris](https://github.com/simplifaisoul/osiris)
and retains its map/rendering foundation. The inherited MIT grant and notices
remain applicable to that code. The project-wide **GNU GPL v3.0** terms remain
in [LICENSE](LICENSE); contributor and dependency notices remain in force.
This documentation update does not relicense code or add an incompatible
blanket “all rights reserved” restriction.
