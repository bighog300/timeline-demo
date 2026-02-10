import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GmailSelectClient from './pageClient';

describe('GmailSelectClient saved search run flow', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('runs a saved search using canonical query when Run is clicked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ messages: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sets: [{ id: 'set-1', title: 'Invoices', updatedAt: '2025-01-01T00:00:00.000Z' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          set: {
            id: 'set-1',
            title: 'Invoices',
            query: { q: 'from:billing@example.com newer_than:30d' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          resultCount: 1,
          nextPageToken: null,
          messages: [
            {
              id: 'msg-1',
              threadId: 'thread-1',
              internalDate: Date.now(),
              snippet: 'Invoice attached',
              from: { name: 'Billing', email: 'billing@example.com' },
              subject: 'January invoice',
              date: 'Mon, 1 Jan 2025 12:00:00 +0000',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<GmailSelectClient isConfigured />);

    await screen.findByText('Invoices');

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await screen.findByText(/Saved search: Invoices · Query:/i);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/selection-sets/set-1');
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/google/gmail/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'from:billing@example.com newer_than:30d', maxResults: 50, pageToken: null }),
    });
  });
});
