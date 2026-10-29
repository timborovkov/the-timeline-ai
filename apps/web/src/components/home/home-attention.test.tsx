import { cleanup, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { CircleAlert } from 'lucide-react';

import { HomeAttention, type AttentionGroup } from '@/components/home/home-attention';
// Test environment: happy-dom

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

  it('names the region Attention without a visible heading', () => {
    render(<HomeAttention groups={[group('Approvals', 2)]} />);
    expect(screen.getByRole('region', { name: 'Attention' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Attention' })).toBeNull();
  });
});
