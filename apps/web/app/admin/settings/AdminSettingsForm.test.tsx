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
});
