import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminSettingsForm from './AdminSettingsForm';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AdminSettingsForm', () => {
  it('renders template helper text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          settings: {
            type: 'admin_settings',
            version: 1,
            provider: 'stub',
            model: 'stub-model',
            systemPrompt: '',
            summaryPromptTemplate: '',
            highlightsPromptTemplate: '',
            maxOutputTokens: 120,
            maxContextItems: 5,
            temperature: 0.2,
            updatedAtISO: new Date().toISOString(),
          },
        }),
      }),
    );

    render(<AdminSettingsForm />);

    expect(await screen.findByText(/Supported template tokens/i)).toBeInTheDocument();
  });

  it('calls PUT endpoint when Save is clicked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          settings: {
            type: 'admin_settings',
            version: 1,
            provider: 'stub',
            model: 'stub-model',
            systemPrompt: '',
            summaryPromptTemplate: '',
            highlightsPromptTemplate: '',
            maxOutputTokens: 120,
            maxContextItems: 5,
            temperature: 0.2,
            updatedAtISO: new Date().toISOString(),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          settings: {
            type: 'admin_settings',
            version: 1,
            provider: 'stub',
            model: 'stub-model',
            systemPrompt: '',
            summaryPromptTemplate: '',
            highlightsPromptTemplate: '',
            maxOutputTokens: 120,
            maxContextItems: 5,
            temperature: 0.2,
            updatedAtISO: new Date().toISOString(),
          },
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<AdminSettingsForm />);
    await screen.findByDisplayValue('stub-model');

    fireEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/admin/settings',
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });


  it('runs backfill and renders summary counts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          settings: {
            type: 'admin_settings',
            version: 1,
            provider: 'stub',
            model: 'stub-model',
            systemPrompt: '',
            summaryPromptTemplate: '',
            highlightsPromptTemplate: '',
            maxOutputTokens: 120,
            maxContextItems: 5,
            temperature: 0.2,
            updatedAtISO: new Date().toISOString(),
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          dryRun: true,
          limit: 10,
          scanned: 2,
          updated: 1,
          skippedAlreadyHasDate: 1,
          noDateFound: 0,
          items: [
            {
              fileId: 'file-1',
              title: 'Summary one',
              before: null,
              after: '2024-05-01T00:00:00.000Z',
              status: 'updated',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<AdminSettingsForm />);
    expect(await screen.findByText(/Maintenance/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Backfill content dates for existing summaries/i));
    fireEvent.click(screen.getByRole('button', { name: /Run backfill/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/timeline/artifacts/backfill-content-dates',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ limit: 10, dryRun: true }),
        }),
      );
    });

    expect(await screen.findByText(/scanned: 2/i)).toBeInTheDocument();
  });

});
