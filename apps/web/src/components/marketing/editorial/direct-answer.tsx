import { Check } from 'lucide-react';

import styles from '@/components/marketing/editorial/editorial.module.css';

export function DirectAnswer({
  answer,
}: {
  answer: { title: string; body: string; checklist: readonly string[] };
}) {
  return (
    <aside
      aria-label="Direct answer"
      className={`${styles.indexRule} border-y border-border py-8 pl-7 sm:pl-9`}
    >
      <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
        Start with the answer
      </p>
      <h2 className="mt-5 text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
        {answer.title}
      </h2>
      <p className="mt-5 text-base leading-7 text-fg-muted">{answer.body}</p>
      <ul className="mt-7 grid gap-3">
        {answer.checklist.map((item) => (
          <li key={item} className="grid grid-cols-[1rem_1fr] gap-3 text-sm leading-6">
            <Check aria-hidden="true" className="mt-1 size-4 text-signal" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
