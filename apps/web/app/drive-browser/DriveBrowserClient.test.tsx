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

  it('posts selected files to create-from-items payload', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('My selection');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { id: 'f1', name: 'Folder 1', mimeType: 'application/vnd.google-apps.folder', modifiedTime: null, webViewLink: null, isFolder: true },
              { id: 'd1', name: 'Doc 1', mimeType: 'application/pdf', modifiedTime: '2025-01-01T00:00:00.000Z', webViewLink: null, isFolder: false },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ fileId: 'new-1' }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveBrowserClient />);

    await screen.findByText('Doc 1');
    fireEvent.click((await screen.findAllByLabelText('Select Doc 1'))[0]);
    fireEvent.click(screen.getByRole('button', { name: /save as new saved selection/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/timeline/selections/create-from-items',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string) as {
      source: string;
      items: Array<{ id: string }>;
    };

    expect(body.source).toBe('drive');
    expect(body.items).toEqual([{ id: 'd1', name: 'Doc 1', mimeType: 'application/pdf', modifiedTime: '2025-01-01T00:00:00.000Z' }]);
  });

  it('posts selected files to add-items payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { id: 'd1', name: 'Doc 1', mimeType: 'application/pdf', modifiedTime: '2025-01-01T00:00:00.000Z', webViewLink: null, isFolder: false },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ fileId: 'sel-1', name: 'Selection A' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ added: 1 }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveBrowserClient />);

    await screen.findByText('Doc 1');
    fireEvent.click((await screen.findAllByLabelText('Select Doc 1'))[0]);
    fireEvent.click((await screen.findAllByRole('button', { name: /add to existing/i }))[0]);
    await screen.findByRole('button', { name: /add selected files/i });
    fireEvent.click(screen.getByRole('button', { name: /add selected files/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        '/api/timeline/selections/sel-1/add-items',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const body = JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string) as {
      source: string;
      items: Array<{ id: string }>;
    };

    expect(body.source).toBe('drive');
    expect(body.items[0]?.id).toBe('d1');
  });
});
