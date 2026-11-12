import { TRUST_FLOW_CHIPS, TRUST_FLOW_STEPS } from '@/components/marketing/trust-flow-content';

export function TrustFlowPanel() {
  return (
    <div data-trust-flow aria-labelledby="trust-flow-title">
      <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
        How one answer stays trustworthy
      </p>
      <h2
        id="trust-flow-title"
        className="mt-4 max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl"
      >
        Every answer carries its evidence chain.
      </h2>
      <p className="mt-4 max-w-3xl text-base leading-8 text-fg-muted">
        Timeline preserves source content, checks access at retrieval, and keeps citations attached
        to the answer. If evidence suggests a lasting workspace change, Timeline proposes it for
        human review instead of applying it on its own.
      </p>
      <ol className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {TRUST_FLOW_STEPS.map((step) => (
          <li key={step.index} className="bg-bg p-5 sm:p-6">
            <span className="font-mono text-[0.68rem] tracking-[0.12em] text-signal">
              {step.index}
            </span>
            <strong className="mt-3 block text-base font-semibold text-fg">{step.title}</strong>
            <small className="mt-2 block text-sm text-fg-muted">{step.detail}</small>
          </li>
        ))}
      </ol>
      <ul className="mt-6 flex flex-wrap gap-2" aria-label="Timeline evidence safeguards">
        {TRUST_FLOW_CHIPS.map((chip) => (
          <li
            key={chip}
            className="border border-border px-3 py-2 font-mono text-[0.68rem] tracking-[0.08em] text-fg-muted uppercase"
          >
            {chip}
          </li>
        ))}
      </ul>
    </div>
  );
}
