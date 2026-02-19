import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GettingStartedPageClient from './pageClient';

const mockUseSession = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));

describe('GettingStartedPageClient', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders all five step titles', () => {
    mockUseSession.mockReturnValue({ status: 'unauthenticated', data: null });

    render(<GettingStartedPageClient isAuthConfigured />);

    expect(screen.getByRole('heading', { name: '1) Connect Google' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2) Provision Drive folder' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3) Select 3 documents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '4) Summarize selection' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '5) Ask a timeline question' })).toBeInTheDocument();
  });

  it('keeps Open chat disabled when artifacts are empty', async () => {
    mockUseSession.mockReturnValue({ status: 'authenticated', data: { driveFolderId: 'folder-1' } });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sets: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artifacts: [] }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<GettingStartedPageClient isAuthConfigured />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/artifacts/list');
    });

    const openChat = screen.getByRole('link', { name: 'Open chat' });
    expect(openChat).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Summarize documents first.')).toBeInTheDocument();
  });
});
