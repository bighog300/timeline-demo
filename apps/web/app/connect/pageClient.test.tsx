import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ConnectPageClient from './pageClient';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated', update: vi.fn() }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

describe('ConnectPageClient', () => {
  it('renders the Connect Google button when signed out', () => {
    render(<ConnectPageClient isConfigured />);

    expect(screen.getByRole('button', { name: /connect google/i })).toBeInTheDocument();
  });
});
