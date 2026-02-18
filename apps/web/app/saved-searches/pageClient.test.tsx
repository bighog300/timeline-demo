import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SavedSearchesPageClient from './pageClient';

describe('SavedSearchesPageClient', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads and renders both gmail and drive sets', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/saved-searches') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            sets: [
              { id: 'g-1', title: 'Gmail invoices', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'gmail_selection_set', source: 'gmail' },
              { id: 'd-1', title: 'Drive PDFs', updatedAt: '2025-01-02T00:00:00.000Z', kind: 'drive_selection_set', source: 'drive' },
            ],
          }),
        } as Response;
      }

      if (url === '/api/runs?limit=10') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ runs: [] }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SavedSearchesPageClient isConfigured />);

    await screen.findByText('Gmail invoices');
    await screen.findByText('Drive PDFs');
    expect(screen.getByText('Gmail saved searches')).toBeInTheDocument();
    expect(screen.getByText('Drive saved searches')).toBeInTheDocument();
    expect(screen.getByText('Recent runs')).toBeInTheDocument();
  });

  it('rename flow calls PATCH and updates UI', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/saved-searches') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              sets: [{ id: 'g-1', title: 'Old title', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'gmail_selection_set', source: 'gmail' }],
            }),
          } as Response;
        }

        if (url === '/api/runs?limit=10') {
          return { ok: true, status: 200, json: async () => ({ runs: [] }) } as Response;
        }

        if (url === '/api/saved-searches/g-1') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ title: 'New title', updatedAt: '2025-01-03T00:00:00.000Z' }),
          } as Response;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<SavedSearchesPageClient isConfigured />);
    await screen.findByText('Old title');

    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]);
    fireEvent.change(screen.getByLabelText('Rename Old title'), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('New title');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/saved-searches/g-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New title' }),
      });
    });
  });

  it('delete flow requires DELETE and calls endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/saved-searches') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              sets: [{ id: 'd-1', title: 'Drive PDFs', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'drive_selection_set', source: 'drive' }],
            }),
          } as Response;
        }

        if (url === '/api/runs?limit=10') {
          return { ok: true, status: 200, json: async () => ({ runs: [] }) } as Response;
        }

        if (url === '/api/saved-searches/d-1') {
          return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
        }

        throw new Error(`Unexpected fetch: ${url}`);
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<SavedSearchesPageClient isConfigured />);
    await screen.findByText('Drive PDFs');

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    const confirmButton = screen.getByRole('button', { name: 'Confirm delete' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Confirm delete Drive PDFs'), { target: { value: 'DELETE' } });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/saved-searches/d-1', { method: 'DELETE' });
    });
    await waitFor(() => {
      expect(screen.queryByText('Drive PDFs')).not.toBeInTheDocument();
    });
  });

  it('renders recent runs list from /api/runs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/saved-searches') {
        return { ok: true, status: 200, json: async () => ({ sets: [] }) } as Response;
      }

      if (url === '/api/runs?limit=10') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            runs: [
              {
                id: 'run-1',
                action: 'summarize',
                status: 'partial_success',
                selectionSet: {
                  id: 'set-1',
                  title: 'Invoices',
                  source: 'gmail',
                  kind: 'gmail_selection_set',
                  query: { q: 'from:a@example.com' },
                },
                startedAt: '2025-01-01T00:00:00.000Z',
                finishedAt: '2025-01-01T00:01:00.000Z',
                counts: { foundCount: 50, processedCount: 40, failedCount: 10 },
                requestIds: ['req-1'],
                artifact: { id: 'run-1' },
              },
            ],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SavedSearchesPageClient isConfigured />);

    await screen.findByText('Invoices');
    expect(screen.getByText('partial_success')).toBeInTheDocument();
    expect(screen.getByText('Found: 50 • Processed: 40 • Failed: 10')).toBeInTheDocument();
  });
});
