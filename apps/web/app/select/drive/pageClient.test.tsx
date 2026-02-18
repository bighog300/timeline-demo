import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DriveSelectClient from './pageClient';

const mockUseSession = vi.fn(() => ({ status: 'authenticated', data: { driveFolderId: 'folder-123' } }));

vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));


describe('DriveSelectClient', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('runs saved drive search when Run is clicked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sets: [{ id: 'set-1', title: 'PDFs', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'drive_selection_set', source: 'drive' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ set: { id: 'set-1', title: 'PDFs', kind: 'drive_selection_set', query: { q: "trashed=false and mimeType='application/pdf'" } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, resultCount: 1, nextPageToken: null, files: [{ id: 'file-1', name: 'Doc', mimeType: 'application/pdf', modifiedTime: null, createdTime: null, size: null, webViewLink: null, owner: { name: '', email: '' }, parents: [] }] }),
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveSelectClient isConfigured />);

    await screen.findByText('PDFs');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await screen.findByText(/Saved search: PDFs · Query:/i);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/saved-searches/set-1'));

    expect(fetchMock).toHaveBeenCalledWith('/api/google/drive/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: "trashed=false and mimeType='application/pdf'", pageSize: 50, pageToken: null }),
    });
  });

  it('summarizes selected drive results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          resultCount: 2,
          nextPageToken: null,
          files: [
            { id: 'file-1', name: 'Doc 1', mimeType: 'application/pdf', modifiedTime: null, createdTime: null, size: null, webViewLink: null, owner: { name: '', email: '' }, parents: [] },
            { id: 'file-2', name: 'Doc 2', mimeType: 'application/pdf', modifiedTime: null, createdTime: null, size: null, webViewLink: null, owner: { name: '', email: '' }, parents: [] },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ artifacts: [{ sourceId: 'file-1' }, { sourceId: 'file-2' }], failed: [] }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveSelectClient isConfigured />);
    await screen.findByText(/No saved searches yet/i);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText(/Results \(2\)/i);

    fireEvent.click(screen.getByRole('button', { name: /Select all \(this page\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /Summarize selected now/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [{ source: 'drive', id: 'file-1' }, { source: 'drive', id: 'file-2' }] }),
      });
    });
  });

  it('caps summarize saved search collection at 50 files', async () => {
    const firstPage = Array.from({ length: 30 }, (_, index) => ({ id: `file-${index + 1}`, name: 'Doc', mimeType: 'application/pdf', modifiedTime: null, createdTime: null, size: null, webViewLink: null, owner: { name: '', email: '' }, parents: [] }));
    const secondPage = Array.from({ length: 30 }, (_, index) => ({ id: `file-${index + 31}`, name: 'Doc', mimeType: 'application/pdf', modifiedTime: null, createdTime: null, size: null, webViewLink: null, owner: { name: '', email: '' }, parents: [] }));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [{ id: 'set-1', title: 'Large set', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'drive_selection_set', source: 'drive' }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ set: { kind: 'drive_selection_set', query: { q: 'trashed=false' } } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ files: firstPage, nextPageToken: 'next-2' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ files: secondPage, nextPageToken: 'next-3' }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ artifacts: Array.from({ length: 10 }, (_, index) => ({ sourceId: `file-${index + 1}` })), failed: [] }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveSelectClient isConfigured />);
    await screen.findByText('Large set');

    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm summarize/i }));

    await screen.findByText(/Reached cap of 50 files/i);

    const summarizeCalls = fetchMock.mock.calls.filter((call) => call[0] === '/api/timeline/summarize');
    expect(summarizeCalls.length).toBe(5);
  });

  it('copies file id and shows notice', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sets: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          resultCount: 1,
          nextPageToken: null,
          files: [
            { id: 'file-1', name: 'Doc', mimeType: 'application/pdf', modifiedTime: null, createdTime: null, size: '1024', webViewLink: 'https://drive.google.com/file/d/1', owner: { name: 'A', email: 'a@example.com' }, parents: [] },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<DriveSelectClient isConfigured />);
    await screen.findByText(/No saved searches yet/i);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText(/Results \(1\)/i);

    fireEvent.click(screen.getByRole('button', { name: /Copy file ID for Doc/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('file-1');
    });
    await screen.findByText('Copied file ID.');
  });

  it('disables app folder toggle when drive folder is missing', async () => {
    mockUseSession.mockReturnValue({ status: 'authenticated', data: { driveFolderId: undefined } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ sets: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<DriveSelectClient isConfigured />);

    const toggle = await screen.findByRole('checkbox', { name: /Limit to app folder/i });
    expect(toggle).toBeDisabled();
    expect(screen.getByText('Provision Drive folder on /connect.')).toBeInTheDocument();
  });

});
