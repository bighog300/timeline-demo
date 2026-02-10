import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SelectionSetsPageClient from './pageClient';

describe('SelectionSetsPageClient', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads and renders both gmail and drive sets', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sets: [
          { id: 'g-1', title: 'Gmail invoices', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'gmail_selection_set', source: 'gmail' },
          { id: 'd-1', title: 'Drive PDFs', updatedAt: '2025-01-02T00:00:00.000Z', kind: 'drive_selection_set', source: 'drive' },
        ],
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<SelectionSetsPageClient isConfigured />);

    await screen.findByText('Gmail invoices');
    await screen.findByText('Drive PDFs');
    expect(screen.getByText('Gmail saved searches')).toBeInTheDocument();
    expect(screen.getByText('Drive saved searches')).toBeInTheDocument();
  });

  it('rename flow calls PATCH and updates UI', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sets: [{ id: 'g-1', title: 'Old title', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'gmail_selection_set', source: 'gmail' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ title: 'New title', updatedAt: '2025-01-03T00:00:00.000Z' }),
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<SelectionSetsPageClient isConfigured />);
    await screen.findByText('Old title');

    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]);
    fireEvent.change(screen.getByLabelText('Rename Old title'), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('New title');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/selection-sets/g-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New title' }),
      });
    });
  });

  it('delete flow requires DELETE and calls endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sets: [{ id: 'd-1', title: 'Drive PDFs', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'drive_selection_set', source: 'drive' }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<SelectionSetsPageClient isConfigured />);
    await screen.findByText('Drive PDFs');

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    const confirmButton = screen.getByRole('button', { name: 'Confirm delete' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Confirm delete Drive PDFs'), { target: { value: 'DELETE' } });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/selection-sets/d-1', { method: 'DELETE' });
    });
    await waitFor(() => {
      expect(screen.queryByText('Drive PDFs')).not.toBeInTheDocument();
    });
  });
});
