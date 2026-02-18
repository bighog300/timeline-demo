import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pathnameMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: pathnameMock,
}));

import AppNav from './AppNav';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AppNav demo tabs visibility', () => {
  it('hides calendar and chat tabs by default', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_TABS', undefined);
    pathnameMock.mockReturnValue('/timeline');

    render(<AppNav />);

    expect(screen.queryByRole('link', { name: 'Calendar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Saved Selections' })).toBeInTheDocument();
  });

  it('shows calendar and chat tabs when feature flag is enabled', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_DEMO_TABS', 'true');
    pathnameMock.mockReturnValue('/timeline');

    render(<AppNav />);

    expect(screen.getByRole('link', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chat' })).toBeInTheDocument();
  });
});
