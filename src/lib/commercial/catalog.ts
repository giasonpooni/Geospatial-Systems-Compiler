/** Commercial packaging, not an entitlement, invoice, or production-readiness claim. */
export const COMMERCIAL_SKUS = [
  {
    id: 'seat', name: 'Commodity / Corridor Seat', contract: 'seat-order',
    unit: 'named seat / contracted term', status: 'validation-required',
    scope: 'One commodity or one corridor; a citable finding without the builder in the room.',
    buyers: 'Commodity desks, trade houses, procurement teams and cargo analysts.',
    pricing: 'Scoped paid evaluation first. Annual seat pricing is not yet validated.',
    requires: ['Non-builder demand evidence', 'Memo-ready evidence and refusal export', 'Source rights for display and export'],
  },
  {
    id: 'feed', name: 'Licensed Physical-State Feed', contract: 'feed-order',
    unit: 'licensed scope / delivery schedule', status: 'licensing-required',
    scope: 'A specified region, commodity or corridor, delivered with vintages and coverage.',
    buyers: 'Carriers, 3PLs, trade-finance teams, insurers and industrial data teams.',
    pricing: 'Quote only after upstream rights, delivery cost and service scope are established.',
    requires: ['Customer- and scope-specific redistribution rights', 'Retained source vintages', 'Qualified delivery, correction and support process'],
  },
  {
    id: 'watch', name: 'Industrial-Object Watch', contract: 'watch-order',
    unit: 'contracted object set / cadence / coverage', status: 'service-qualification-required',
    scope: 'A customer-supplied set of organisations, sites or transport objects; not a larger basemap.',
    buyers: 'Cargo and P&I insurers, trade houses, object-screening teams and site lenders.',
    pricing: 'Quote only against a bounded object set and measured monitoring capacity.',
    requires: ['Object-only scope and watch-alert rights', 'Operational / financial / regulatory event separation', 'Coverage-gap reporting and qualified notification delivery'],
  },
] as const;

export type Sku = typeof COMMERCIAL_SKUS[number]['id'];
export type Delivery = 'seat_display' | 'memo_export' | 'bulk_feed' | 'watch_alert';
export type Scope = { kind: 'commodity' | 'corridor' | 'region' | 'portfolio'; id: string };
export const DELIVERY_BY_SKU: Readonly<Record<Sku, readonly Delivery[]>> = {
  seat: ['seat_display', 'memo_export'], feed: ['bulk_feed'], watch: ['watch_alert'],
};
export const OBJECT_KINDS = ['organisation', 'site', 'mill', 'berth', 'vessel', 'aircraft', 'parcel', 'voyage', 'commodity'] as const;
export const PURPOSES = ['commodity_state', 'supply_chain_intelligence', 'site_intelligence', 'object_sanctions'] as const;
export const WATCH_EVENT_CLASSES = ['operational', 'financial', 'regulatory'] as const;
export const WATCH_TRIGGERS = ['excursion', 'posting_window', 'coverage_gap'] as const;

/** A planning assumption, NOT a posted price or competitor benchmark. */
export const SEAT_VALUE_TEST = { currency: 'USD', amountMinor: 1_000_000, status: 'planning-assumption' } as const;
