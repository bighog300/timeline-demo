import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DriveSelectClient from './pageClient';

const pushMock = vi.fn();
const mockUseSession = vi.fn(() => ({ status: 'authenticated', data: { driveFolderId: 'folder-123' } }));

vi.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  pushMock.mockReset();
});

describe('Drive selection bar', () => {
  it('disables actions with zero selection and shows hint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [] }) }));

    render(<DriveSelectClient isConfigured />);

    expect(await screen.findByText('Select items to continue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summarize selected' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save selection set' })).toBeDisabled();
  });

  it('save then summarize uses timeline endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, resultCount: 1, nextPageToken: null, files: [{ id: 'file-1', name: 'Doc', mimeType: 'application/pdf', modifiedTime: null, createdTime: null, size: null, webViewLink: null, owner: { name: '', email: '' }, parents: [] }] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ set: { driveFileId: 'sel-1' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ artifacts: [{ sourceId: 'file-1' }], failed: [] }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveSelectClient isConfigured />);
    await screen.findAllByText(/No saved searches yet/i);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText(/Results \(1\)/i);
    fireEvent.click(screen.getByRole('button', { name: /Select all \(this page\)/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Summarize selected' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/selection/save', expect.objectContaining({ method: 'POST' }));
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/summarize', expect.objectContaining({ method: 'POST' }));
      expect(pushMock).toHaveBeenCalledWith('/timeline?from=select&selectionSetId=sel-1');
    });
  });
});
