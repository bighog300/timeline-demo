import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import SavedSelectionsClient from './SavedSelectionsClient';

describe('SavedSelectionsClient', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders Saved Selections header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) }),
    );

    render(<SavedSelectionsClient />);

    expect(screen.getByRole('heading', { name: 'Saved Selections' })).toBeInTheDocument();
    await screen.findByText('No saved selections yet. Create one from Chat context.');
  });

  it('rename triggers PATCH and refresh', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [{ fileId: 'f-1', name: 'Old - Selection.json' }] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ fileId: 'f-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [{ fileId: 'f-1', name: 'New - Selection.json' }] }),
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<SavedSelectionsClient />);
    await screen.findByText('Old');

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Rename Old'), { target: { value: 'New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/selections/f-1/rename', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New' }),
      });
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('delete triggers DELETE and refresh', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ items: [{ fileId: 'f-1', name: 'Old - Selection.json' }] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [] }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<SavedSelectionsClient />);
    await screen.findByText('Old');

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/selections/f-1', { method: 'DELETE' });
    });
    expect(refreshMock).toHaveBeenCalled();
  });
});
