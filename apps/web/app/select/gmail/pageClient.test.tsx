import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GmailSelectClient from './pageClient';

const baseSearchResult = {
  id: 'msg-1',
  threadId: 'thread-1',
  internalDate: Date.now(),
  snippet: 'Invoice attached',
  from: { name: 'Billing', email: 'billing@example.com' },
  subject: 'January invoice',
  date: 'Mon, 1 Jan 2025 12:00:00 +0000',
};

describe('GmailSelectClient', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('runs a saved search using canonical query when Run is clicked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [] }) })
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
        json: async () => ({ resultCount: 1, nextPageToken: null, messages: [baseSearchResult] }),
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

  it('summarizes selected search results via timeline summarize endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ resultCount: 2, nextPageToken: null, messages: [baseSearchResult, { ...baseSearchResult, id: 'msg-2' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ artifacts: [{ sourceId: 'msg-1' }, { sourceId: 'msg-2' }], failed: [] }),
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<GmailSelectClient isConfigured />);

    await screen.findByText(/No saved searches yet/i);
    fireEvent.change(screen.getByPlaceholderText(/Add sender email/i), { target: { value: 'billing@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add sender/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText(/Results \(2\)/i);

    fireEvent.click(screen.getByRole('button', { name: /Select all \(this page\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /Summarize selected now/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [
            { source: 'gmail', id: 'msg-1' },
            { source: 'gmail', id: 'msg-2' },
          ],
        }),
      });
    });

    expect(await screen.findByText(/Summarized 2 emails/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Timeline/i })).toHaveAttribute('href', '/timeline');
  });

  it('shows reconnect CTA when summarize returns reconnect_required', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ messages: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ resultCount: 1, nextPageToken: null, messages: [baseSearchResult] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'x-request-id': 'req-401' }),
        json: async () => ({ error: { code: 'reconnect_required', message: 'Reconnect required.' } }),
        clone() {
          return this;
        },
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<GmailSelectClient isConfigured />);

    await screen.findByText(/No saved searches yet/i);
    fireEvent.change(screen.getByPlaceholderText(/Add sender email/i), { target: { value: 'billing@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Add sender/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByText(/Results \(1\)/i);

    fireEvent.click(screen.getByRole('button', { name: /Select all \(this page\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /Summarize selected now/i }));

    expect(await screen.findByText(/Google connection expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Reconnect/i })).toHaveAttribute('href', '/connect');
  });
});
