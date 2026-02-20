import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TimelineArtifact } from '../lib/timeline/exportBuilder';
import MissingInfo from './MissingInfo';

const artifacts: TimelineArtifact[] = [{
  entryKey: '1',
  artifact: {
    artifactId: 'a1',
    source: 'drive',
    sourceId: 'src-1',
    title: 'Artifact one',
    createdAtISO: '2026-01-01T00:00:00.000Z',
    summary: 'No amount listed',
    highlights: ['h'],
    driveFolderId: 'folder',
    driveFileId: 'file-1',
    model: 'stub',
    version: 1,
  },
}];

describe('MissingInfo', () => {
  it('renders counts, opens fixer, saves annotation and updates UI', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, artifactId: 'file-1', userAnnotations: { entities: ['Alice'] } }), { status: 200 }),
    );

    render(<MissingInfo artifacts={artifacts} />);

    expect(screen.getByText(/Entities missing: 1/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /fix/i })[0]);
    expect(screen.getByText(/Fix missing entities/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Entities \(comma separated\)/i), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/quality/apply-annotation', expect.objectContaining({ method: 'POST' }));
      expect(screen.getByText(/Annotation saved/i)).toBeInTheDocument();
      expect(screen.getByText(/Entities missing: 0/)).toBeInTheDocument();
    });
  });
});
