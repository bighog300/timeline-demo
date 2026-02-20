import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TimelineArtifact } from '../lib/timeline/exportBuilder';
import TimelineQuality from './TimelineQuality';

const artifacts: TimelineArtifact[] = [
  {
    entryKey: '1',
    artifact: {
      artifactId: 'a1',
      source: 'drive',
      sourceId: 'src-1',
      title: 'Artifact one',
      createdAtISO: '2026-01-01T00:00:00.000Z',
      summary: 'Summary includes 2026-02-14',
      highlights: ['h'],
      driveFolderId: 'folder',
      driveFileId: 'file-1',
      model: 'stub',
      version: 1,
    },
  },
];

describe('TimelineQuality', () => {
  it('renders counts and applies selected candidate', async () => {
    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ dateISO: '2026-02-14T00:00:00.000Z', confidence: 'medium', source: 'text_regex', evidenceSnippet: '2026-02-14' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, artifactId: 'file-1', contentDateISO: '2026-02-14T00:00:00.000Z' }), { status: 200 }));

    render(<TimelineQuality artifacts={artifacts} />);

    expect(screen.getByText(/Total: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Undated: 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /fix undated dates/i }));
    fireEvent.click(screen.getByRole('button', { name: /find date/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/quality/date-candidates', expect.objectContaining({ method: 'POST' }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/2026-02-14T00:00:00.000Z/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /apply/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/quality/apply-date', expect.objectContaining({ method: 'POST' }));
      expect(screen.getByText(/Date applied/i)).toBeInTheDocument();
    });
  });
});
