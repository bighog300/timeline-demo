import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GmailSelectClient from './pageClient';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  pushMock.mockReset();
});

describe('Gmail selection bar', () => {
  it('shows disabled buttons for empty selection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [] }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<GmailSelectClient isConfigured />);

    expect(await screen.findByText('Select items to continue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summarize selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save selection set' })).toBeDisabled();
  });

  it('summarize action saves then routes to timeline', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ resultCount: 1, nextPageToken: null, messages: [{ id: 'msg-1', threadId: 'thread-1', internalDate: Date.now(), snippet: 'Snippet', from: { name: 'Billing', email: 'billing@example.com' }, subject: 'Invoice', date: new Date().toISOString() }] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ set: { driveFileId: 'gmail-sel-1' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ artifacts: [{ sourceId: 'msg-1' }], failed: [] }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<GmailSelectClient isConfigured />);
    await screen.findAllByText(/No saved searches yet/i);

    fireEvent.change(screen.getAllByPlaceholderText(/Add sender email/i)[0], { target: { value: 'billing@example.com' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Add sender/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText(/Results \(1\)/i);
    fireEvent.click(screen.getByRole('button', { name: /Select all \(this page\)/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Summarize selected' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/selection/save', expect.objectContaining({ method: 'POST' }));
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/summarize', expect.objectContaining({ method: 'POST' }));
      expect(pushMock).toHaveBeenCalledWith('/timeline?from=select&selectionSetId=gmail-sel-1');
    });
  });
});
