# Procurement specifications — three separate order schedules

Status: **draft operational specifications for procurement and legal review**.
These are not signed contracts, a completed DPA or claims of regulatory compliance.
Keep executed agreements and negotiation details private.

## Common schedule

Record the contracting organisation, order reference/version, service description,
start/end, currency, taxes/fees treatment, permitted purpose and exact scope.
Repeat the source-registry and collection policy: industrial objects only;
sanctions screening only organisations, vessels and aircraft; no buyer-requested
expansion to natural-person yield. Distinguish the hosted data/service agreement
from the existing software licence. It does not relicense inherited or GPL code.

Attach the reviewed source-rights schedule: licensed fields, sources/vintages,
allowed recipients and uses, derived-use treatment, attribution obligations,
territories, term, onward sharing, revocation, retention/deletion and audit
requirements. Resolve conflicts before an offer; the API must not broaden the
rights written in the schedule. A denied use stays denied even when budget remains.

State support days, time zone and staffed hours; response targets distinct from
resolution targets; incident/correction handling; excluded upstream outages;
service measurement and any agreed remedy. Do not imply 24/7 support or a live SLA
from a code fixture. State a named owner and escalation route in the private order.

Where a ceiling/draw-down arrangement is agreed, name the authorised ceiling,
minimum commitment (including zero), metered units, unit rates, expiry, overage
approval and remaining balance reporting. A ceiling is not a purchase order,
recognised revenue or guaranteed utilisation. No unapproved overage.

## Seat order (`seat-order`)

Specify one commodity or corridor, named-seat count, term, approved display and
memo-export uses, evidence-pack format, included history, correction process and
support hours. Specify whether an evaluation fee is credited to a later order.
Record trial scope, the private query/miss/refusal/export-log references and
non-builder value evidence. Keep evaluation payments distinct from annual prices.
Require values, units, valueKind, basis, source/vintage, known-at time and unresolved
or refused outcomes to survive export. Do not promise a production seat from a
successful demonstration alone.

## Feed order (`feed-order`)

Specify region/commodity/corridor, fields, object coverage, schema version,
permitted use/recipients, historical depth, delivery schedule/time zone,
posting/late-data windows, file/API format, correction/replay rules, integrity
manifests and acceptance tests. Include rights for every source input, not just the
final combined output. A nightly regional push is a delivery obligation requiring
upstream rights and measured operations, not an adapter setting. Document quotas,
ceilings/draw-down units, support hours and outage notifications.

## Watch order (`watch-order`)

Attach a versioned portfolio of resolved industrial objects and a documented
add/remove process. Specify unique-object count, cadence, operational/financial/
regulatory event classes, excursion thresholds and units, posting window,
coverage-gap window, destinations, notification deduplication, replay and
acknowledgement handling. Record tested capacity evidence for that cadence.
State coverage and detection limitations explicitly; silence is not an all-clear.
Changing the set or cadence requires requalification, rights review and any
agreed price change—not an implicit unlimited subscription.

## Data-processing and permitted-use schedule

Before execution, review the parties' actual processing roles and obligations,
authorised instructions, account/operational data categories, access controls,
subprocessors, security/incident handling, retention/deletion, audit process and
applicable transfer requirements. Do not assert roles or compliance from a
boilerplate label. The permitted-use schedule repeats the collection boundary
and rejects onward uses that the product does not permit. Organisational account
administration is not permission to sell personal-location records.
