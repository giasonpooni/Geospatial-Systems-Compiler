/** Opt-in server-side acquisition. One fixed USGS catalog request; no asset/link traversal. */
import { CATALOG_ORIGIN, LANDSAT_COLLECTION, MAX_SNAPSHOT_BYTES, SceneError,
  assertLandsatSource, makeSnapshotReceipt, parseSceneQuery } from './stacScenes';

export function landsatSearchUrl(query: unknown): string {
  const q = parseSceneQuery(query);
  const url = new URL(`${CATALOG_ORIGIN}/search`);
  url.searchParams.set('collections', LANDSAT_COLLECTION);
  url.searchParams.set('bbox', q.aoi.bbox.join(','));
  url.searchParams.set('datetime', `${q.interval.start}/${q.interval.end}`);
  url.searchParams.set('limit', String(q.limit));
  // Cloud filtering remains local so unknown/filtered rows are explicitly accounted for.
  return url.href;
}
export class CatalogError extends Error {
  constructor(public readonly code: 'CATALOG_UNAVAILABLE' | 'CATALOG_HTTP_ERROR' | 'CATALOG_REDIRECT'
    | 'CATALOG_MEDIA_TYPE' | 'CATALOG_BODY_LIMIT' | 'CATALOG_EMPTY_BODY') { super(code); this.name = 'CatalogError'; }
}
/** Injected fetch/clock are trusted test/host dependencies, never supplied request data. */
export async function collectLandsatSnapshot(query: unknown, deps: {
  fetch: typeof globalThis.fetch; now: () => string;
} = { fetch: globalThis.fetch, now: () => new Date().toISOString() }) {
  const q = parseSceneQuery(query); assertLandsatSource();
  const url = landsatSearchUrl(q), abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const response = await deps.fetch(url, { method: 'GET', redirect: 'error', signal: abort.signal,
      headers: { Accept: 'application/geo+json, application/json' } });
    if (response.redirected || (response.url && new URL(response.url).origin !== new URL(CATALOG_ORIGIN).origin)) throw new CatalogError('CATALOG_REDIRECT');
    if (!response.ok) throw new CatalogError('CATALOG_HTTP_ERROR');
    const media = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!['application/json', 'application/geo+json'].includes(media)) throw new CatalogError('CATALOG_MEDIA_TYPE');
    const length = response.headers.get('content-length');
    if (length && Number(length) > MAX_SNAPSHOT_BYTES) throw new CatalogError('CATALOG_BODY_LIMIT');
    if (!response.body) throw new CatalogError('CATALOG_EMPTY_BODY');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_SNAPSHOT_BYTES) throw new CatalogError('CATALOG_BODY_LIMIT');
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    if (total === 0) throw new CatalogError('CATALOG_EMPTY_BODY');
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const receipt = makeSnapshotReceipt(bytes, q, deps.now(), 'operational');
    return { bytes, receipt, query: q };
  } catch (error) {
    if (error instanceof CatalogError || error instanceof SceneError) throw error;
    throw new CatalogError('CATALOG_UNAVAILABLE');
  } finally { clearTimeout(timer); abort.abort(); }
}
