# Physical-economy products: seat, feed, watch

Status: **commercial qualification**, not a live rate card. This changes packaging
and adds tested preflight checks. It does not turn an adapter into a resale
licence, deploy a service, certify a legal document, or add billing.

GSC / Frame Mapper remains the representation and inspection authority. NET
controls execution; ESM owns evidence and released state. These product contracts
do not absorb those repositories or change the existing code licence.

## Buyers and the information they buy

Target customers are commodity desks and trade houses; cargo, freight and P&I
insurers; trade-finance teams; AEC firms, developers and site lenders; compliance
teams screening organisations, vessels and aircraft; and carriers or 3PLs needing
plant-and-corridor state. These are target segments, not named customers.

The proposed premium is provenance + refusal + quantity basis + operational
control versus economic interest. Do not publish competitor spending, contract
ceilings, willingness to pay, notarial status or production scale as established
facts without retained evidence. An attestation can establish a bounded statement
about identified inputs and computation; it does not establish that every source
claim is true or grant redistribution rights.

## Pricing and packaging

| SKU | Contracted unit | Pricing posture | First qualification |
| --- | --- | --- | --- |
| Seat | Named seat, one commodity **or** one corridor, explicit term | Paid scoped evaluation; no validated annual rate yet | Non-builder demand, memo-ready export, rights for display and export |
| Feed | Commodity, corridor or region; licensed fields and delivery schedule | Negotiated quote after upstream rights and cost review | Exact source/customer/scope rights plus a qualified delivery and correction process |
| Watch | Versioned customer-object portfolio, cadence, event classes and coverage | Negotiated subscription against measured capacity | Resolved industrial identities, watch-alert rights, bounded capacity and visible gaps |

Research use and commercial redistribution are separate questions. Preserve
accessible research inspection within source terms; do not paywall the existence
of provenance or hide refusals as a premium feature.

**Seat value test:** the supplied approximately $10,000 benchmark is represented
as **USD 10,000** (1,000,000 minor units), an explicit planning assumption because
the instruction did not name a currency. It is not a market-derived price. The
code uses this as a minimum qualification threshold, not an approximate match.
Record scope and term with the payment or buyer-validated value. Do not compare
CAD and USD silently, annualise an evaluation payment, or count the builder's own
valuation. A pass allows commercial review, **not an automatic USD 20,000 annual
seat claim**. A larger seat quote needs its own buyer evidence and service scope.

For Feed, quote the licence cost, scoped delivery volume/frequency, retained
history, integration, corrections and support. For Watch, quote unique contracted
objects, cadence, event classes, source coverage and support—not the number of
noisy alerts. A $650,000 regional-feed scenario is not a current rate or revenue.
A contract ceiling is a maximum authorised draw-down, not guaranteed spend.

No price formula is presented as validated here. Before an offer, document the
actual upstream cost, compute/storage, operations, correction burden, support
hours and proposed margin. Keep customer names, negotiated prices and source
agreements in private systems, not this public repository.

## Build and qualify in order

### Pipe 0 — preserve the collection boundary

The existing source-registry refusal, route-surface gate and shipped-description
gate remain mandatory. Natural-person yield does not become acceptable because a
buyer requests it. Sanctions remain organisations/vessels/aircraft only. The new
commercial preflight is an additional check, not a replacement for any gate.
No new API route, person-resolution service or collection adapter is added.

### Pipe 1 — a seat that gets reopened

Choose one commodity or corridor. Reuse existing query/session, miss, refusal and
export evidence; do not create a parallel log merely for sales. Prepare a private
trial packet identifying the retained query and miss-log slices, the source each
addressed gap needs, the exported finding, and the customer's decision context.
An export click alone is not evidence that a finding entered outside work.

Keep [CONTINUE_CRITERION.md](../CONTINUE_CRITERION.md) unchanged. Its pre-registered
90-day maintenance decision is not the seat-pricing decision. The commercial
summary in `qualifySeatValue` checks non-builder demand and separately recorded
payment/value evidence. It assumes a trusted operator has substantiated those
references; it does not read or authenticate receipts or logs.

Every numeric result must carry its existing `valueKind` (reported, estimated,
representative or derived), unit, `QuantityBasis`, observation/knowledge dates,
source and vintage. Derived results carry their operation and input identities.
Refused or missing is not zero. Include uncertainty, coverage and disagreement
when present; absence remains explicit. Validate the existing memo/export paths
end-to-end before a paid delivery; this change does not replace their serializers.

### Pipe 2 — licensed physical feeds

Westmetall research access remains research-only unless an independently reviewed
grant explicitly permits the requested production use. Archived Comtrade vintages,
USGS MCS, licensed AIS/vessel or freight indices, and official parcel/zoning data
are candidate sources, not automatically cleared feeds. Do not infer rights from
availability, public ownership, an HTML adapter, or this repository's software licence.

Retain terms, a review record and the exact source vintage. Explicitly record
customer, scope, validity window, display/export/feed/alert rights, derived-use
permission and collection-policy acceptance. All source inputs in transitive
lineage must qualify. A licence to display does not imply a right to export or
redistribute. Missing, pending, research-only, revoked, expired or ambiguous
records refuse delivery qualification. There are **no approved production grants
shipped in this patch**. See [integration and limits](INTEGRATION.md).

### Pipe 3 — identity of industrial objects

Keep the existing `UnresolvedIdentifier` record: scheme, raw identifier, source,
occurrences, candidates, context and remedy. Similar names never establish an
identity merge. Use jurisdiction plus register/identifier scheme and evidence
validity; a parcel PIN without its jurisdiction is not globally unique. An HS
code classifies a commodity; it is not an identifier for a particular mill or
shipment. A berth is not its port; a site is not its operator.

Operator/control and shareholder/economic-interest relationships stay distinct,
with their own effective dates and provenance. Do not resolve people while
resolving industrial objects. Existing canonical entity kinds are not expanded
by the commercial subject vocabulary: vessel, aircraft, parcel and voyage
adapters still need their own contracts and qualification where absent.

### Pipe 4 — standing watch

The contract identifies the exact, versioned customer set. Admission requires
resolved register entries and a retained capacity qualification; an `ent:` prefix
or near match alone is not evidence. Keep operational, financial and regulatory
events separate. Qualify excursion, posting-window and coverage-gap triggers.
The latter cannot be omitted. Unknown coverage is not an all-clear.

For production, retain event identity, occurrence time, known-at time, source
vintage, detection time, delivery attempts, acknowledgement and correction
history. Qualification requires deterministic replay, idempotency/deduplication,
tenant isolation, source-outage handling, a notification outbox and a tested
scheduler. None is created by the in-memory `qualifyWatch` preflight. The bounded
validator accepts at most 10,000 IDs per call; this is an input bound, not a tested
service capacity. **1,000 to 1,000,000 objects is a scaling ambition, not a shipped
throughput claim.**

### Pipe 5 — procurement

Use supply-chain intelligence, commodity state, site intelligence and
sanctions-on-objects as the service description. Seat, Feed and Watch have
separate order schedules. Each repeats the collection boundary and explicitly
records support hours, limits, correction handling and termination. The proposed
DPA/use schedule must not create a route around the API's subject restrictions.
See [procurement specifications](PROCUREMENT.md); these are not executed contracts.
