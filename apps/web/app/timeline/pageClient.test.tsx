import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TimelinePageClient from './pageClient';

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

describe('TimelinePageClient', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an empty state when no selections exist', () => {
    render(<TimelinePageClient />);

    expect(screen.getByText(/no items selected yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate summaries/i })).toBeDisabled();
  });

  it('shows reconnect CTA when summarize returns 401', async () => {
    setSelections();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'reconnect_required' }), { status: 401 }),
    );

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
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'drive_not_provisioned' }), { status: 400 }),
    );

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

  it('syncs artifacts from Drive when clicking sync button', async () => {
    setSelections();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ artifacts: [syncArtifact], files: [] }), { status: 200 }),
    );

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

  it('shows reconnect CTA when sync returns 401', async () => {
    setSelections();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'reconnect_required' }), { status: 401 }),
    );

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
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'drive_not_provisioned' }), { status: 400 }),
    );

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
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ artifacts: [syncArtifact], files: [] }), { status: 200 }),
    );

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/timeline/artifacts/list');
      expect(screen.getByText(/synced 1 artifacts from drive/i)).toBeInTheDocument();
    });
  });
});
