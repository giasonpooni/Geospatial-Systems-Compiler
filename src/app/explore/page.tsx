import type { Metadata } from 'next';
import Link from 'next/link';
import { loadPublicProjection } from '@/lib/explorer/loadProjection';
import { ProjectionRefusal } from '@/lib/explorer/esmProjection';
import ProjectionExplorer from './ProjectionExplorer';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Notation Systems | Visual explorer',
  description: 'Read-only inspection of one explicitly published ESM projection, preserving record identity, evidence and time.',
  openGraph: { title: 'Notation Systems | Visual explorer', description: 'Exact records, geographic inspection and supporting evidence.' },
};
export default async function ExplorePage() {
  let data: Awaited<ReturnType<typeof loadPublicProjection>> | null = null;
  let refusal = '';
  try {
    data = await loadPublicProjection({ enabled: process.env.NOTATION_PUBLIC_EXPLORER_ENABLED,
      esmOrigin: process.env.NOTATION_ESM_ORIGIN, specJson: process.env.NOTATION_PUBLIC_PROJECTION_SPEC,
      digest: process.env.NOTATION_PUBLIC_PROJECTION_DIGEST, viewerUrl: process.env.NOTATION_GSV_EMBED_URL });
  } catch (error) { refusal = error instanceof ProjectionRefusal ? error.code : 'PROJECTION_UNAVAILABLE'; }
  return <main style={{ position: 'fixed', inset: 0, overflow: 'auto', background: '#09121e', color: '#e4edf5', padding: '40px 24px', zIndex: 100 }}>
    <div style={{ maxWidth: 1180, margin: '0 auto', lineHeight: 1.65 }}>
      <nav style={{ display: 'flex', gap: 24 }}><Link href="/notation">Notation Systems</Link><Link href="/">Existing Payload Terminal</Link></nav>
      <h1 style={{ fontSize: 38, marginTop: 24 }}>Visual explorer</h1>
      <p style={{ fontSize: 18, marginBottom: 24 }}>Geography, recorded values and evidence — one exact projection across every view.</p>
      {data ? <ProjectionExplorer projection={data.projection} viewerUrl={data.viewerUrl} /> :
        <section role="status" style={{ padding: 24, border: '1px solid #34455a', borderRadius: 12 }}>
          <h2 style={{ fontSize: 22 }}>No public projection loaded</h2><p><code>{refusal}</code></p>
          <p>The explorer requires an explicitly configured public fixture projection and its exact digest. It does not substitute synthetic records, obtain internal material, or guess a current release.</p>
          <p>The existing Payload application remains available. Deployment configuration is documented in <code>docs/NOTATION_EXPLORER.md</code>.</p>
        </section>}
    </div>
  </main>;
}
