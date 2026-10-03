import { SOURCE_REGISTRY } from './sourceRegistry';
import { validateIndustrialObservation, type QualityContext, type QualityResult } from './industrialObservationQuality';

/** Application entrypoint: registry authority cannot come from the request.
 * `supplied` is an upstream evidence-owner snapshot, NOT parsed request JSON.
 * This reads no files or network, admits no evidence, and publishes nothing.
 */
export function inspectIndustrialObservation(
  input: unknown,
  supplied: Omit<QualityContext, 'sources'>,
): QualityResult {
  return validateIndustrialObservation(input, { ...supplied, sources: SOURCE_REGISTRY });
}
