/** Server-side publication adapter. No caller-controlled URL, records or time. */
import { MAX_PROJECTION_BYTES, ProjectionRefusal, parsePublicProjectionSpec,
  safeHttpUrl, validatePublicProjection } from './esmProjection.ts';

export interface ExplorerConfig {
  enabled?: string; esmOrigin?: string; specJson?: string; digest?: string; viewerUrl?: string;
}
export async function loadPublicProjection(config: ExplorerConfig, fetcher: typeof fetch = fetch) {
  if (config.enabled !== '1' || !config.esmOrigin || !config.specJson || !config.digest || !config.viewerUrl)
    throw new ProjectionRefusal('EXPLORER_NOT_CONFIGURED');
  let spec, endpoint, viewer;
  try {
    endpoint = safeHttpUrl(config.esmOrigin);
    if (endpoint.pathname !== '/') throw new ProjectionRefusal('INVALID_ENDPOINT');
    viewer = safeHttpUrl(config.viewerUrl);
    if (!viewer.pathname.endsWith('/embed.html')) throw new ProjectionRefusal('INVALID_ENDPOINT');
    if (new TextEncoder().encode(config.specJson).length > 32_768) throw new ProjectionRefusal('INVALID_PROJECTION');
    spec = parsePublicProjectionSpec(JSON.parse(config.specJson));
    if (!/^sha256:[a-f0-9]{64}$/.test(config.digest)) throw new ProjectionRefusal('INVALID_PROJECTION');
  } catch { throw new ProjectionRefusal('INVALID_EXPLORER_CONFIGURATION'); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(new URL('/api/projections/preview', endpoint), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(spec), signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit',
    });
    if (!response.ok || response.headers.get('x-payload-fixture-only') !== 'true' ||
        response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body)
      throw new ProjectionRefusal('PROJECTION_UNAVAILABLE');
    const reader = response.body.getReader();
    const parts: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_PROJECTION_BYTES) throw new ProjectionRefusal('PROJECTION_TOO_LARGE');
        parts.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const projection = await validatePublicProjection(input, { spec, digest: config.digest });
    return { projection, viewerUrl: viewer.toString() };
  } catch (error) {
    if (error instanceof ProjectionRefusal) throw error;
    throw new ProjectionRefusal('PROJECTION_UNAVAILABLE');
  } finally { clearTimeout(timer); }
}
