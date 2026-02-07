import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CalendarPageClient from './pageClient';

describe('CalendarPageClient', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const entryResponse = {
    entries: [
      {
        type: 'calendar_entry',
        id: 'cal-1',
        title: 'Team sync',
        startISO: '2024-04-01T09:00:00Z',
        endISO: '2024-04-01T09:30:00Z',
        allDay: false,
        location: 'Room 2A',
        notes: 'Weekly check-in.',
        tags: ['team'],
        source: 'user',
        createdAtISO: '2024-03-25T10:00:00Z',
        updatedAtISO: '2024-03-26T10:00:00Z',
      },
    ],
  };

  const summaryResponse = {
    artifacts: [
      {
        artifactId: 'drive:file-1',
        source: 'drive',
        sourceId: 'file-1',
        title: 'Weekly summary',
        createdAtISO: '2024-04-01T00:00:00Z',
        summary: 'Summary content',
        highlights: [],
        driveFolderId: 'folder-1',
        driveFileId: 'file-1',
        driveWebViewLink: 'https://drive.google.com/file-1',
        model: 'stub',
        version: 1,
      },
    ],
  };

  const buildFetchMock = () =>
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/calendar/entries') {
        return Promise.resolve(
          new Response(JSON.stringify(entryResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url === '/api/timeline/artifacts/list') {
        return Promise.resolve(
          new Response(JSON.stringify(summaryResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

  it('renders entries and timeline summaries', async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<CalendarPageClient />);

    expect(await screen.findByText(/Team sync/i)).toBeInTheDocument();
    expect(screen.getByText(/Weekly summary/i)).toBeInTheDocument();
  });

  it('toggles timeline summaries on and off', async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<CalendarPageClient />);

    expect(await screen.findByText(/Weekly summary/i)).toBeInTheDocument();

    const toggle = screen.getByLabelText(/Timeline Summaries/i);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.queryByText(/Weekly summary/i)).not.toBeInTheDocument();
    });

    fireEvent.click(toggle);
    expect(await screen.findByText(/Weekly summary/i)).toBeInTheDocument();
  });

  it('opens the entry drawer when a calendar entry is clicked', async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    render(<CalendarPageClient />);

    const entryButton = await screen.findByRole('button', { name: /Team sync/i });
    fireEvent.click(entryButton);

    expect(await screen.findByText(/Entry details/i)).toBeInTheDocument();
    expect(screen.getByText(/Weekly check-in/i)).toBeInTheDocument();
  });
});
