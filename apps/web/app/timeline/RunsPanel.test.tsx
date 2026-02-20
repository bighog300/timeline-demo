import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RunsPanel from './RunsPanel';

const mockFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    return handler(url, init);
  });
};

describe('RunsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders Progress panel and summary row', async () => {
    mockFetch((url) => {
      if (url.startsWith('/api/runs')) {
        return new Response(
          JSON.stringify({
            runs: [
              {
                id: 'run-1',
                action: 'summarize',
                status: 'success',
                startedAt: '2025-01-01T00:00:00.000Z',
                finishedAt: '2025-01-01T00:01:00.000Z',
                selectionSet: { id: 'set-1', title: 'Invoices' },
                artifact: { result: { note: null } },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    render(<RunsPanel fromSelect={false} selectionSetId={null} runId={null} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Progress' })).toBeInTheDocument();
      expect(screen.getByText(/Running: 0/i)).toBeInTheDocument();
      expect(screen.getByText(/Completed: 1/i)).toBeInTheDocument();
    });
  });

  it('starts interval refresh when there is a running run', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    mockFetch((url) => {
      if (url.startsWith('/api/runs')) {
        return new Response(
          JSON.stringify({
            runs: [
              {
                id: 'run-1',
                action: 'summarize',
                status: 'success',
                startedAt: '2025-01-01T00:00:00.000Z',
                finishedAt: null,
                selectionSet: { id: 'set-1', title: 'Invoices' },
                artifact: { result: { note: null } },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    render(<RunsPanel fromSelect={false} selectionSetId={null} runId={null} />);

    await waitFor(() => {
      expect(screen.getByText(/Running: 1/i)).toBeInTheDocument();
    });

    expect(setIntervalSpy).toHaveBeenCalled();
  });

  it('shows failed run error snippet and retry button', async () => {
    mockFetch((url) => {
      if (url.startsWith('/api/runs')) {
        return new Response(
          JSON.stringify({
            runs: [
              {
                id: 'run-failed',
                action: 'summarize',
                status: 'failed',
                startedAt: '2025-01-01T00:00:00.000Z',
                finishedAt: '2025-01-01T00:01:00.000Z',
                selectionSet: { id: 'set-1', title: 'Invoices' },
                artifact: { result: { note: 'Model timeout\nstacktrace...' } },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/runs/run-failed/retry') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<RunsPanel fromSelect={false} selectionSetId={null} runId={null} />);

    await waitFor(() => {
      expect(screen.getByText('Model timeout')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });

  it('uses summarize-missing fallback when retry endpoint does not exist', async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/runs/run-failed/retry') {
        return new Response('Not found', { status: 404 });
      }
      if (url === '/api/timeline/summarize-missing' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.startsWith('/api/runs')) {
        return new Response(
          JSON.stringify({
            runs: [
              {
                id: 'run-failed',
                action: 'summarize',
                status: 'failed',
                startedAt: '2025-01-01T00:00:00.000Z',
                finishedAt: '2025-01-01T00:01:00.000Z',
                selectionSet: { id: 'set-1', title: 'Invoices' },
                artifact: { result: { note: 'failed' } },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      return fetchSpy(url, init);
    });

    render(<RunsPanel fromSelect={false} selectionSetId={null} runId={null} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/runs/run-failed/retry', { method: 'POST' });
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/timeline/summarize-missing',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('calls summarize-missing when button clicked', async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/runs')) {
        return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      }
      if (url === '/api/timeline/summarize-missing' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      return fetchSpy(url, init);
    });

    render(<RunsPanel fromSelect={true} selectionSetId="set-1" runId={null} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Summarize missing' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Summarize missing' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/timeline/summarize-missing',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
