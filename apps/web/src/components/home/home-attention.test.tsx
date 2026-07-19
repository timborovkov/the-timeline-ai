// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { CircleAlert } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';

import { HomeAttention, type AttentionGroup } from '@/components/home/home-attention';

function group(label: string, count: number): AttentionGroup {
  return { href: `/app/${label}`, label, count, action: `Open ${label}`, icon: <CircleAlert /> };
}

describe('HomeAttention', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders a quiet caught-up state when every count is zero', () => {
    render(<HomeAttention groups={[group('Approvals', 0), group('Jobs', 0)]} />);
    expect(screen.getByText('You’re caught up')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders only non-zero groups', () => {
    render(<HomeAttention groups={[group('Approvals', 2), group('Jobs', 0)]} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /2 approvals/i })).toBeTruthy();
    expect(screen.queryByText(/jobs/)).toBeNull();
  });

  it('renders multiple actionable groups', () => {
    render(<HomeAttention groups={[group('Approvals', 2), group('Jobs', 1)]} />);
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
