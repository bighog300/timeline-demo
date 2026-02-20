import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ArtifactDetailsDrawer from './ArtifactDetailsDrawer';

const artifact = {
  entryKey: 'k1',
  artifact: {
    artifactId: 'a1',
    source: 'drive' as const,
    sourceId: 'src1',
    title: 'Doc title',
    createdAtISO: '2024-01-01T00:00:00.000Z',
    contentDateISO: '2024-01-01T00:00:00.000Z',
    summary: 'Summary text',
    highlights: ['h1'],
    entities: [{ name: 'Alice', type: 'person', confidence: 0.9 }],
    driveFolderId: 'f1',
    driveFileId: 'file-1',
    driveWebViewLink: 'https://drive.google.com/file/d/file-1/view',
    model: 'm',
    version: 1,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ArtifactDetailsDrawer', () => {
  it('saves annotations and copies link', async () => {
    const onSaved = vi.fn();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, artifactId: 'file-1', userAnnotations: { note: 'hello' } }), { status: 200 }),
    );
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });

    render(
      <ArtifactDetailsDrawer
        isOpen
        artifactId="file-1"
        artifact={artifact}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('file-1', { note: 'hello' });
    });

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/timeline?artifactId=file-1'));
    });
  });
});
