import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConnectPageClient from './pageClient';

const mockUseSession = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const scopeStatus = {
  configured: ['https://www.googleapis.com/auth/gmail.readonly'],
  missing: [],
  isComplete: true,
};

describe('ConnectPageClient', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the Connect Google button when signed out', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated', update: vi.fn() });
    render(<ConnectPageClient isConfigured scopeStatus={scopeStatus} />);

    expect(screen.getByRole('button', { name: /^connect google$/i })).toBeInTheDocument();
  });

  it('renders the Disconnect button when signed in', () => {
    mockUseSession.mockReturnValue({
      data: { scopes: ['scope-1'], driveFolderId: 'folder-1' },
      status: 'authenticated',
      update: vi.fn(),
    });

    render(<ConnectPageClient isConfigured scopeStatus={scopeStatus} />);

    expect(screen.getByRole('button', { name: /^disconnect google$/i })).toBeInTheDocument();
  });
});
