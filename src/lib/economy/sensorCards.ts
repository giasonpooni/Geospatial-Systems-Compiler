/** Sensor metadata extends sourceRegistry; it is not a second source register or a licence. */
export const SENSOR_LEDGERS = ['physical_flow', 'physical_stock', 'market_price', 'financial_positioning', 'organisational_attribution', 'sanctions_object'] as const;
export type SensorLedger = typeof SENSOR_LEDGERS[number];
export const DEGRADATION_LADDER = ['live', 'ttl_cache', 'last_good', 'snapshot'] as const;
export type SensorRung = typeof DEGRADATION_LADDER[number];
export type LicensePosture = 'public_official' | 'curated_representative' | 'research_only_not_for_resale' | 'licensed_third_party';
export interface SensorCard {
  sourceId: string;
  ledgers: readonly SensorLedger[];
  forbiddenYield: readonly ['natural_person'];
  degradationLadder: readonly SensorRung[];
  /** Empty means the source has no implemented adapter. Snapshot-only is not live-capable. */
  availableRungs: readonly SensorRung[];
  postingWindow: null;
  /** Reuse the registered publication cadence; no invented posting deadline or SLA. */
  freshness: { cadence: string; policy: 'horizon.corpusHealthSignals'; postingWindowKnown: false };
  licensePosture: LicensePosture;
}
export type SensorAcquisition = {
  rung: SensorRung;
  readAt: string;
  /** A successful HTTP acquisition time, never a snapshot or cache-read time. */
  lastLiveAt: string | null;
};
