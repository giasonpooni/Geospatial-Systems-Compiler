import type { Metadata } from 'next';
import Link from 'next/link';
export const metadata: Metadata = {
  title: 'Visualize physical systems | Notation Systems',
  description: 'Geographic inspection, compatible-record comparison and explicit evidence for physical systems.',
  openGraph: { title: 'Notation Systems — Visualize physical systems', description: 'State · Variation · Invariance. Inspect a result without losing its source.' },
};
export default function NotationPage() {
  return <main style={{ position: 'fixed', inset: 0, overflow: 'auto', background: '#09121e', color: '#e4edf5', padding: '48px 28px', zIndex: 100 }}>
    <div style={{ maxWidth: 1180, margin: '0 auto', lineHeight: 1.7 }}>
      <nav style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 20 }}><strong style={{ letterSpacing: 2 }}>NOTATION SYSTEMS</strong><span><Link href="/explore">Visual explorer</Link> · <Link href="/">Payload application</Link></span></nav>
      <p style={{ color: '#8fcadd', marginTop: 60 }}>STATE · VARIATION · INVARIANCE</p>
      <h1 style={{ fontSize: 'clamp(38px,6vw,76px)', lineHeight: 1.05, maxWidth: 940, margin: '24px 0' }}>See the system.<br />Inspect the difference.<br />Trace the evidence.</h1>
      <p style={{ maxWidth: 800, fontSize: 21, margin: '28px 0' }}>Visualization and computational instrumentation for physical systems. Move from a geographic view to a declared value and its source without changing the record you are inspecting.</p>
      <nav style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '32px 0' }}><Link href="/explore" style={{ background: '#b3e5ed', color: '#09121e', padding: '12px 22px', borderRadius: 8 }}>Open the visual explorer</Link><Link href="/" style={{ border: '1px solid #53677e', padding: '12px 22px', borderRadius: 8 }}>Open Payload Terminal</Link></nav>
      <figure style={{ margin: '40px 0', border: '1px solid #34455a', padding: 20, borderRadius: 16 }}>
        <svg role="img" aria-label="Interface schematic: geographic view, recorded-value comparison and evidence connected by one exact projection" viewBox="0 0 1000 310" style={{ display: 'block', width: '100%' }}>
          <g fill="none" stroke="#52859e" strokeWidth="1.5"><circle cx="150" cy="140" r="105"/><ellipse cx="150" cy="140" rx="48" ry="105"/><ellipse cx="150" cy="140" rx="105" ry="38"/><path d="M45 140h210M150 35v210M270 140h95M655 140h85"/></g>
          <g fill="#e4edf5" fontSize="18"><text x="60" y="280">Geographic view</text><text x="385" y="280">Recorded values</text><text x="770" y="280">Evidence</text></g>
          <g fill="none" stroke="#8fcadd" strokeWidth="2"><path d="M385 200h240M505 50v150"/><path d="M405 95h165M405 145h195"/></g><circle cx="570" cy="95" r="7" fill="#8fcadd"/><circle cx="600" cy="145" r="7" fill="#ffcf76"/>
          <rect x="755" y="45" width="210" height="175" rx="10" fill="#101c2a" stroke="#52859e"/><g fill="#b3c8d9" fontSize="15"><text x="775" y="80">Record identity</text><text x="775" y="110">Source and release</text><text x="775" y="140">Units and basis</text><text x="775" y="170">Knowledge / valid time</text><text x="775" y="200">Declared uncertainty</text></g>
        </svg>
        <figcaption>Interface schematic, not measured data. The explorer displays only an explicitly configured public fixture projection; no dataset is substituted when its source is unavailable.</figcaption>
      </figure>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 28 }}>
        <div><h2 style={{ fontSize: 25 }}>State</h2><p>Inspect exact records, geographic points, time selections and missing information. Polygon and extent declarations remain available in the evidence inspector.</p></div>
        <div><h2 style={{ fontSize: 25 }}>Variation</h2><p>Compare two current records with the same subject, predicate, unit and measurement basis. Incompatible comparisons return a reason instead of a misleading number.</p></div>
        <div><h2 style={{ fontSize: 25 }}>Invariance</h2><p>Keep record identity, release, time and source bindings unchanged across views. Physical conservation and model-specific checks belong to the scientific instruments.</p></div>
      </section>
      <section style={{ borderTop: '1px solid #34455a', paddingTop: 28, marginTop: 42 }}><h2 style={{ fontSize: 27 }}>One system, distinct responsibilities</h2><p>ESM governs evidence and release state. GSV renders geographic inspection. The workbench operates instruments. This interface does not create another evidence store or numerical runtime.</p><p>Freight and commodity applications remain available as existing domain workflows. New visual inspection extends them; it does not remove their operating functions.</p><p style={{ color: '#acbed0' }}>Current explorer scope: read-only fixture projections, point display and descriptive record comparison. No live scientific execution, calibrated covariance or independent verification is claimed.</p></section>
    </div>
  </main>;
}
