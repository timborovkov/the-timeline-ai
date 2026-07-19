import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/theme-toggle', () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

const { AuthShell } = await import('@/components/auth-shell');

describe('AuthShell', () => {
  it('renders a bordered auth card with archive eyebrow and secondary link', () => {
    const html = renderToStaticMarkup(
      <AuthShell
        title="Welcome back"
        subtitle="Sign in to your team’s timeline."
        secondaryPrefix="No account yet?"
        secondaryHref="/sign-up"
        secondaryLabel="Create one"
      >
        <form>form</form>
      </AuthShell>,
    );

    expect(html).toContain('Secure access · Cited team memory');
    expect(html).toContain('Welcome back');
    expect(html).toContain('href="/sign-up"');
    expect(html).toContain('Create one');
    expect(html).toContain('bg-surface');
  });
});
