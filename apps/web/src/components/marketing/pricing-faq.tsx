import { PRICING_FAQS } from '@/components/marketing/pricing-faq-content';

export function PricingFaq() {
  return (
    <div className="mt-10 divide-y divide-border border-y border-border" data-pricing-faq>
      {PRICING_FAQS.map((faq) => (
        <details key={faq.question} className="group py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-5 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
            {faq.question}
            <span aria-hidden="true" className="font-mono text-signal group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="max-w-3xl pb-6 text-sm leading-7 text-fg-muted sm:text-base">
            {faq.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
