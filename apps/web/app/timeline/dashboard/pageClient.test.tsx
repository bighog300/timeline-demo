import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import TimelineDashboardPageClient from './pageClient';

describe('TimelineDashboardPageClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders actions and handles accept/dismiss updates', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          summary: { totalArtifacts: 2, totalSyntheses: 1, proposedActions: 1, openLoopsOpenCount: 1, highRisksCount: 0, decisionsRecentCount: 0 },
          syntheses: [{ artifactId: 'syn-1', title: 'S1' }],
          actionQueue: [
            {
              artifactId: 'file-1',
              artifactTitle: 'A1',
              artifactKind: 'summary',
              action: { id: 'act-1', type: 'task', text: 'Do thing', status: 'proposed' },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, status: 'accepted' }) });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<TimelineDashboardPageClient />);

    expect(await screen.findByText('Do thing')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Accept'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/actions', expect.any(Object));
    });
  });

  it('shows inline error when calendar event creation fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          summary: { totalArtifacts: 1, totalSyntheses: 0, proposedActions: 1, openLoopsOpenCount: 1, highRisksCount: 0, decisionsRecentCount: 0 },
          syntheses: [],
          actionQueue: [
            {
              artifactId: 'file-1',
              artifactTitle: 'A1',
              artifactKind: 'summary',
              action: { id: 'act-1', type: 'calendar', text: 'Book time', status: 'proposed' },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'calendar_event_failed' }) });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<TimelineDashboardPageClient />);

    expect(await screen.findByText('Book time')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Accept'));

    expect(await screen.findByText('Could not create Google Calendar event. Please try again.')).toBeInTheDocument();
  });

  it('links top entity drilldown to timeline filter URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        summary: { totalArtifacts: 1, totalSyntheses: 0, proposedActions: 0, openLoopsOpenCount: 0, highRisksCount: 0, decisionsRecentCount: 0 },
        topEntities: [{ name: 'acme', count: 2 }],
        syntheses: [],
        actionQueue: [],
      }),
    }) as unknown as typeof fetch);

    render(<TimelineDashboardPageClient />);
    const link = await screen.findByRole('link', { name: 'acme' });
    expect(link).toHaveAttribute('href', '/timeline?entity=acme');
  });

});

it('runs week in review workflow', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        summary: { totalArtifacts: 1, totalSyntheses: 0, proposedActions: 0, openLoopsOpenCount: 0, highRisksCount: 0, decisionsRecentCount: 0 },
        topEntities: [],
        syntheses: [],
        actionQueue: [],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        synthesis: { synthesis: { content: 'Weekly summary' }, citations: [{ artifactId: 'a1', excerpt: 'x' }], savedArtifactId: 'syn-1' },
        report: { driveFileId: 'r1', driveFileName: 'report.md' },
      }),
    });

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  render(<TimelineDashboardPageClient />);
  fireEvent.click((await screen.findAllByText('Generate Week in Review'))[0]);

  expect(await screen.findByText('Weekly summary')).toBeInTheDocument();
  expect(await screen.findByText('Citations: 1')).toBeInTheDocument();
});
