import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DriveBrowserClient from './DriveBrowserClient';
import { cleanup } from '@testing-library/react';

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('DriveBrowserClient', () => {
  beforeEach(() => {
    cleanup();
    pushMock.mockReset();
    replaceMock.mockReset();
    vi.restoreAllMocks();
  });

  it('switching scope browses with scope=root', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveBrowserClient />);

    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'root' } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/drive/browse?scope=root'));
    });
  });

  it('selecting folder and preview triggers resolve-selection', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'folder-1', name: 'Folder 1', mimeType: 'application/vnd.google-apps.folder', modifiedTime: null, webViewLink: null, isFolder: true }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ dryRun: true, limit: 200, foundFiles: 2, truncated: false, files: [{ id: 'f1', name: 'Doc 1' }] }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveBrowserClient />);

    await screen.findByLabelText('Select Folder 1');
    fireEvent.click(screen.getByLabelText('Select Folder 1'));
    fireEvent.click(screen.getByRole('button', { name: /add to timeline/i }));
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/drive/resolve-selection',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('create-from-drive-browse posts payload and shows success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'file-1', name: 'Doc 1', mimeType: 'application/pdf', modifiedTime: '2025-01-01T00:00:00.000Z', webViewLink: null, isFolder: false }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ fileId: 'sel-1', count: 1, truncated: false }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveBrowserClient />);

    await screen.findByText('Doc 1');
    fireEvent.click(screen.getByLabelText('Select Doc 1'));
    fireEvent.click(screen.getByRole('button', { name: /add to timeline/i }));
    fireEvent.change(screen.getByLabelText('Selection name'), { target: { value: 'My Selection' } });
    fireEvent.click(screen.getByRole('button', { name: /create new saved selection/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/timeline/selections/create-from-drive-browse',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const body = JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string) as { scope: string; picked: Array<{ id: string }> };
    expect(body.scope).toBe('app');
    expect(body.picked[0]?.id).toBe('file-1');
    expect(await screen.findByText(/saved new selection/i)).toBeInTheDocument();
  });
});
