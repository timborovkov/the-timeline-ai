import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

await vi.mock(
  import.meta.resolve('@/app/actions/auth'),
  () => ({
    signInWithGoogleAction: vi.fn(),
    signInWithGitHubAction: vi.fn(),
  }),
  () => import('@/app/actions/auth'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { GitHubSignInButton } = await import('./github-button.js');
const { GoogleSignInButton } = await import('./google-button.js');
const { OAuthSignInButtons } = await import('./oauth-buttons.js');

afterEach(cleanup);

describe('GoogleSignInButton', () => {
  it('uses the official G on a borderless white tile at or above the 12px type floor', () => {
    render(<GoogleSignInButton callbackUrl="/app" />);

    const button = screen.getByRole('button', { name: 'Continue with Google' });
    expect(button.className).toContain('text-sm');
    expect(button.className).not.toMatch(/text-xs|text-\[1[01]px\]/);

    const tile = button.querySelector('span.bg-white');
    expect(tile).toBeTruthy();
    expect(tile?.className).toContain('bg-white');
    expect(tile?.className).not.toMatch(/border/);

    const logo = tile?.querySelector('svg');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
    expect(logo?.getAttribute('viewBox')).toBe('0 0 48 48');
  });
});

describe('GitHubSignInButton', () => {
  it('uses the official Invertocat on a borderless white tile at or above the 12px type floor', () => {
    render(<GitHubSignInButton callbackUrl="/app" />);

    const button = screen.getByRole('button', { name: 'Continue with GitHub' });
    expect(button.className).toContain('text-sm');
    expect(button.className).not.toMatch(/text-xs|text-\[1[01]px\]/);

    const tile = button.querySelector('span.bg-white');
    expect(tile).toBeTruthy();
    expect(tile?.className).toContain('bg-white');
    expect(tile?.className).not.toMatch(/border/);

    const logo = tile?.querySelector('svg');
    expect(logo?.getAttribute('aria-hidden')).toBe('true');
    expect(logo?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(logo?.getAttribute('fill')).toBe('#181717');
  });
});

describe('OAuthSignInButtons', () => {
  it('hides the Google control when credentials are not configured', () => {
    render(<OAuthSignInButtons github google={false} />);

    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeTruthy();
  });

  it('renders nothing when neither provider is configured', () => {
    const { container } = render(<OAuthSignInButtons github={false} google={false} />);
    expect(container.textContent).toBe('');
    expect(container.querySelectorAll('button, hr, p')).toHaveLength(0);
  });

  it('shows Google before GitHub without a second divider', () => {
    const { container } = render(<OAuthSignInButtons github google />);

    const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual(['Continue with Google', 'Continue with GitHub']);
    expect(container.querySelectorAll('hr')).toHaveLength(2);
  });
});
