import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TimelinePageClient from './pageClient';

const mockFetch = (handler: (url: string, init?: RequestInit) => Response) => {
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    return handler(url, init);
  });
};

const buildApiError = (status: number, code: string, message: string) =>
  new Response(
    JSON.stringify({
      error: { code, message },
      error_code: code,
    }),
    { status },
  );

const setSelections = () => {
  window.localStorage.setItem(
    'timeline.gmailSelections',
    JSON.stringify([
      {
        id: 'msg-1',
        threadId: 'thread-1',
        subject: 'Hello',
        from: 'alice@example.com',
        date: '2024-01-01T00:00:00Z',
        snippet: 'Snippet',
      },
    ]),
  );
};

const syncArtifact = {
  artifactId: 'gmail:msg-1',
  source: 'gmail',
  sourceId: 'msg-1',
  title: 'Hello',
  createdAtISO: '2024-01-02T00:00:00Z',
  summary: 'Synced summary',
  highlights: ['First highlight'],
  driveFolderId: 'folder-1',
  driveFileId: 'file-1',
  driveWebViewLink: 'https://drive.google.com/file',
  model: 'stub',
  version: 1,
};

const artifactWithMetadata = {
  ...syncArtifact,
  sourceMetadata: {
    from: 'alice@example.com',
    subject: 'Hello',
    threadId: 'thread-1',
    labels: ['INBOX'],
  },
  sourcePreview: 'Preview text from the message body.',
};

const selectionList = [
  {
    driveFileId: 'selection-1',
    name: 'Sprint 1',
    updatedAtISO: '2024-02-01T00:00:00Z',
  },
  {
    driveFileId: 'selection-2',
    name: 'Sprint 2',
    updatedAtISO: '2024-02-02T00:00:00Z',
    driveWebViewLink: 'https://drive.google.com/selection',
  },
];

const selectionSet = {
  id: 'set-1',
  name: 'Sprint 1',
  createdAtISO: '2024-02-01T00:00:00Z',
  updatedAtISO: '2024-02-02T00:00:00Z',
  items: [
    { source: 'gmail', id: 'msg-1', title: 'Hello', dateISO: '2024-01-01T00:00:00Z' },
    { source: 'drive', id: 'file-1', title: 'Spec', dateISO: '2024-01-03T00:00:00Z' },
  ],
  notes: 'Notes',
  version: 1,
  driveFolderId: 'folder-1',
  driveFileId: 'selection-1',
  driveWebViewLink: 'https://drive.google.com/selection-1',
};

describe('TimelinePageClient', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an empty state when no selections exist', () => {
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    expect(screen.getByText(/no items selected yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate summaries/i })).toBeDisabled();
  });

  it('shows reconnect CTA when summarize returns 401', async () => {
    setSelections();
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url === '/api/timeline/summarize') {
        return buildApiError(401, 'reconnect_required', 'Reconnect required.');
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate summaries/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /generate summaries/i }));

    await waitFor(() => {
      expect(screen.getByText(/reconnect required/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /connect your google account/i })).toBeInTheDocument();
    });
  });

  it('shows provision CTA when summarize returns drive_not_provisioned', async () => {
    setSelections();
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url === '/api/timeline/summarize') {
        return buildApiError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate summaries/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /generate summaries/i }));

    await waitFor(() => {
      expect(screen.getByText(/provision a drive folder/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /\/connect/i })).toBeInTheDocument();
    });
  });

  it('shows a rate limit notice when summarize is rate limited', async () => {
    setSelections();
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url === '/api/timeline/summarize') {
        return buildApiError(429, 'rate_limited', 'Too many requests. Try again in a moment.');
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate summaries/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /generate summaries/i }));

    await waitFor(() => {
      expect(screen.getByText(/too many requests/i)).toBeInTheDocument();
    });
  });

  it('syncs artifacts from Drive when clicking sync button', async () => {
    setSelections();
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url === '/api/timeline/artifacts/list') {
        return new Response(JSON.stringify({ artifacts: [syncArtifact], files: [] }), {
          status: 200,
        });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sync from drive/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /sync from drive/i }));

    await waitFor(() => {
      expect(screen.getByText(/synced 1 artifacts from drive/i)).toBeInTheDocument();
      expect(screen.getByText(/synced summary/i)).toBeInTheDocument();
    });
  });

  it('renders search results from Drive-scoped search', async () => {
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url.startsWith('/api/timeline/search')) {
        return new Response(
          JSON.stringify({
            q: 'roadmap',
            type: 'all',
            results: [
              {
                kind: 'selection',
                driveFileId: 'selection-1',
                driveWebViewLink: 'https://drive.google.com/selection',
                title: 'Roadmap set',
                updatedAtISO: '2024-02-02T00:00:00Z',
                snippet: 'Mentions the roadmap',
                matchFields: ['name'],
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    fireEvent.change(screen.getByPlaceholderText(/search summaries or selection sets/i), {
      target: { value: 'roadmap' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText(/roadmap set/i)).toBeInTheDocument();
      expect(screen.getAllByText(/selection set/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('link', { name: /open in drive/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /load set/i })).toBeInTheDocument();
    });
  });

  it('shows an inline hint when the search query is too short', async () => {
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    fireEvent.change(screen.getByPlaceholderText(/search summaries or selection sets/i), {
      target: { value: 'a' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText(/enter at least 2 characters/i)).toBeInTheDocument();
    });
  });

  it('shows reconnect CTA when search returns 401', async () => {
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url.startsWith('/api/timeline/search')) {
        return buildApiError(401, 'reconnect_required', 'Reconnect required.');
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    fireEvent.change(screen.getByPlaceholderText(/search summaries or selection sets/i), {
      target: { value: 'plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText(/search needs a reconnect/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /connect your google account/i })).toBeInTheDocument();
    });
  });

  it('shows an upstream timeout notice when search fails', async () => {
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url.startsWith('/api/timeline/search')) {
        return buildApiError(504, 'upstream_timeout', 'Google request timed out. Please retry.');
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    fireEvent.change(screen.getByPlaceholderText(/search summaries or selection sets/i), {
      target: { value: 'plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText(/google returned an error/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry search/i })).toBeInTheDocument();
    });
  });

  it('shows reconnect CTA when sync returns 401', async () => {
    setSelections();
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url === '/api/timeline/artifacts/list') {
        return buildApiError(401, 'reconnect_required', 'Reconnect required.');
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sync from drive/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /sync from drive/i }));

    await waitFor(() => {
      expect(screen.getByText(/drive sync needs a reconnect/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /connect your google account/i })).toBeInTheDocument();
    });
  });

  it('shows provision CTA when sync returns drive_not_provisioned', async () => {
    setSelections();
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url === '/api/timeline/artifacts/list') {
        return buildApiError(400, 'drive_not_provisioned', 'Drive folder not provisioned.');
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sync from drive/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /sync from drive/i }));

    await waitFor(() => {
      expect(screen.getByText(/provision a drive folder to sync summaries/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /\/connect/i })).toBeInTheDocument();
    });
  });

  it('auto-syncs on open when enabled', async () => {
    setSelections();
    window.localStorage.setItem('timeline.autoSyncOnOpen', 'true');
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url === '/api/timeline/artifacts/list') {
        return new Response(JSON.stringify({ artifacts: [syncArtifact], files: [] }), {
          status: 200,
        });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/timeline/artifacts/list');
      expect(screen.getByText(/synced 1 artifacts from drive/i)).toBeInTheDocument();
    });
  });

  it('saves a selection set and shows a success banner', async () => {
    setSelections();
    mockFetch((url, init) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      if (url === '/api/timeline/selection/save' && init?.method === 'POST') {
        return new Response(JSON.stringify({ set: selectionSet }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    fireEvent.click(screen.getByRole('button', { name: /save selection set/i }));
    fireEvent.change(screen.getByPlaceholderText(/q2 launch research/i), {
      target: { value: 'Sprint 1' },
    });
    fireEvent.change(screen.getByPlaceholderText(/why this selection matters/i), {
      target: { value: 'Core selection' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save to drive/i }));

    await waitFor(() => {
      expect(screen.getByText(/saved set/i)).toBeInTheDocument();
    });
  });

  it('lists saved sets and loads a preview', async () => {
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: selectionList }), { status: 200 });
      }
      if (url.startsWith('/api/timeline/selection/read')) {
        return new Response(JSON.stringify({ set: selectionSet }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByText('Sprint 1')).toBeInTheDocument();
      expect(screen.getByText('Sprint 2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /^Load$/ })[0]);

    await waitFor(() => {
      expect(screen.getByText(/2 items/i)).toBeInTheDocument();
      expect(screen.getByText(/loaded set/i)).toBeInTheDocument();
    });
  });

  it('merges a loaded selection set into local storage', async () => {
    setSelections();
    window.localStorage.setItem(
      'timeline.driveSelections',
      JSON.stringify([
        { id: 'file-2', name: 'Existing', mimeType: 'text/plain', modifiedTime: '2024-01-02' },
      ]),
    );

    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: selectionList }), { status: 200 });
      }
      if (url.startsWith('/api/timeline/selection/read')) {
        return new Response(JSON.stringify({ set: selectionSet }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByText('Sprint 1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /merge into selection/i })[0]);

    await waitFor(() => {
      const gmailStored = JSON.parse(window.localStorage.getItem('timeline.gmailSelections') || '[]');
      const driveStored = JSON.parse(window.localStorage.getItem('timeline.driveSelections') || '[]');
      expect(gmailStored).toHaveLength(1);
      expect(driveStored).toHaveLength(2);
    });
  });

  it('renders source metadata and toggles the content preview', async () => {
    setSelections();
    window.localStorage.setItem('timeline.summaryArtifacts', JSON.stringify({ 'gmail:msg-1': artifactWithMetadata }));
    mockFetch((url) => {
      if (url === '/api/timeline/selection/list') {
        return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByText('From', { selector: 'span' })).toBeInTheDocument();
      expect(screen.getByText('Subject', { selector: 'span' })).toBeInTheDocument();
    });
    expect(screen.getAllByText('alice@example.com').length).toBeGreaterThan(0);

    const previewSummary = screen.getByText(/content preview/i);
    const previewDetails = previewSummary.closest('details');
    expect(previewDetails).not.toHaveAttribute('open');

    fireEvent.click(previewSummary);
    expect(previewDetails).toHaveAttribute('open');
    expect(screen.getByText(/preview text from the message body/i)).toBeInTheDocument();
  });
});
