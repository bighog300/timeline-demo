import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/googleAuth', () => ({
  getGoogleSession: vi.fn(),
}));

vi.mock('../AdminNav', () => ({
  default: () => <nav>Admin nav</nav>,
}));

import { getGoogleSession } from '../../lib/googleAuth';

describe('OpsPage', () => {
  it('renders access denied for non-admin session', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    vi.mocked(getGoogleSession).mockResolvedValue({ user: { email: 'user@example.com' } } as never);

    const { default: OpsPage } = await import('./page');
    render(await OpsPage());

    expect(screen.getByText('Ops Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Access denied (admin only).')).toBeInTheDocument();
  });
});
