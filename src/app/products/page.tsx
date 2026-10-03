import Link from 'next/link';
import { COMMERCIAL_SKUS, SEAT_VALUE_TEST } from '@/lib/commercial/catalog';

export const metadata = {
  title: 'Physical-economy products | GSC',
  description: 'Commodity and corridor seats, licensed physical-state feeds, and industrial-object watches. Qualification requirements and current limitations.',
};

export default function ProductsPage() {
  return (
    <main className="fixed inset-0 overflow-y-auto bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-10">
        <nav aria-label="Product navigation" className="flex gap-6 text-sm text-sky-300">
          <Link href="/">Open the application</Link>
          <Link href="/docs">Technical documentation</Link>
        </nav>
        <header className="max-w-3xl space-y-4">
          <p className="text-sm uppercase tracking-widest text-slate-400">GSC · Physical-economy products</p>
          <h1 className="text-4xl font-semibold tracking-tight">Evidence you can take into a decision.</h1>
          <p className="text-lg text-slate-300">
            Commodity state, supply-chain intelligence and site intelligence for industrial objects.
            The product is provenance, visible basis and explicit refusal—not another location layer.
          </p>
          <p className="rounded-lg border border-amber-700 p-4 text-amber-100">
            Qualification stage. These are three proposed commercial packages, not active subscriptions
            or a claim that licensed feeds, continuous delivery or production service levels are available.
          </p>
        </header>
        <section aria-label="Three products" className="grid gap-6 lg:grid-cols-3">
          {COMMERCIAL_SKUS.map(sku => (
            <article key={sku.id} className="flex flex-col gap-4 rounded-xl border border-slate-700 p-6">
              <p className="text-xs uppercase tracking-wider text-sky-300">{sku.status.replaceAll('-', ' ')}</p>
              <h2 className="text-2xl font-semibold">{sku.name}</h2>
              <p className="text-slate-300">{sku.scope}</p>
              <p className="text-sm text-slate-400">For {sku.buyers}</p>
              <p className="border-t border-slate-700 pt-4 font-medium">{sku.pricing}</p>
              <p className="text-sm text-slate-400">Contract: {sku.contract} · Unit: {sku.unit}</p>
              <h3 className="font-medium">Before a commercial offer</h3>
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
                {sku.requires.map(requirement => <li key={requirement}>{requirement}</li>)}
              </ul>
            </article>
          ))}
        </section>
        <section className="grid gap-8 md:grid-cols-2" aria-label="Evidence and scope">
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold">Keep the distinctions visible.</h2>
            <p className="text-slate-300">
              Reported, estimated, representative and derived values stay labelled. Units, quantity basis,
              dates, source vintages, unresolved identifiers and refusals belong in the memo—not in an invisible tooltip.
              Operational control is not economic interest.
            </p>
          </div>
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold">Validate value before publishing a rate.</h2>
            <p className="text-slate-300">
              The planning test is approximately {SEAT_VALUE_TEST.currency} 10,000 in documented non-builder
              payment or buyer-validated value for a named scope and term. This is not a posted price,
              an annualised revenue claim, or evidence for a 20,000-per-year seat.
            </p>
          </div>
        </section>
        <section className="space-y-3 rounded-xl border border-slate-700 p-6">
          <h2 className="text-2xl font-semibold">Object-only scope. No silent coverage claims.</h2>
          <p className="text-slate-300">
            Natural-person yield is refused. Sanctions screening stays limited to organisations, vessels
            and aircraft. A source adapter is not a redistribution licence. A quiet watch is not proof
            that no event occurred; coverage gaps must remain visible. Contracts cannot expand collection policy.
          </p>
          <p className="text-sm text-slate-400">
            This page does not collect enquiries, start watches, accept payment or grant access.
            GSC remains the representation application; NET and ESM retain their execution and evidence responsibilities.
          </p>
        </section>
      </div>
    </main>
  );
}
