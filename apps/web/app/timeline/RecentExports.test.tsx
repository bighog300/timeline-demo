import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RecentExports from './RecentExports';

describe('RecentExports', () => {
  it('renders empty state', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], updatedAtISO: '2024-01-01T00:00:00.000Z' }), { status: 200 }),
    );

    render(<RecentExports viewMode="summaries" />);

    await waitFor(() => {
      expect(screen.getByText(/no exports yet/i)).toBeInTheDocument();
    });
  });

  it('renders drive doc row with Open link', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              exportId: 'exp-1',
              createdAtISO: '2024-01-01T00:00:00.000Z',
              format: 'drive_doc',
              artifactIds: ['f1'],
              artifactCount: 1,
              source: { viewMode: 'timeline' },
              result: { driveDoc: { docId: 'doc-1', webViewLink: 'https://drive.google.com/doc-1' } },
            },
          ],
          updatedAtISO: '2024-01-01T00:00:00.000Z',
        }),
        { status: 200 },
      ),
    );

    render(<RecentExports viewMode="summaries" />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /open in drive/i })).toHaveAttribute(
        'href',
        'https://drive.google.com/doc-1',
      );
    });
  });

  it('download again triggers PDF POST', async () => {
    const fetchMock = vi.spyOn(global, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                exportId: 'exp-pdf',
                createdAtISO: '2024-01-01T00:00:00.000Z',
                format: 'pdf',
                artifactIds: ['f1', 'f2'],
                artifactCount: 2,
                source: { viewMode: 'summaries' },
                result: { pdf: { filename: 'timeline-report.pdf' } },
              },
            ],
            updatedAtISO: '2024-01-01T00:00:00.000Z',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(new Blob(['pdf']), { status: 200, headers: { 'content-type': 'application/pdf' } }));

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<RecentExports viewMode="timeline" selectionSetId="set-1" from="select" query="foo" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /download again/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /download again/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/timeline/export/pdf',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    clickSpy.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});
