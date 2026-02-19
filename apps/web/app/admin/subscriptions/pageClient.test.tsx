import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SubscriptionsPageClient from './pageClient';

const baseConfig = {
  version: 1,
  updatedAtISO: '2026-01-01T00:00:00.000Z',
  recipientProfiles: [
    { id: 'p1', name: 'P1', to: ['p1@example.com'], filters: { entities: ['acme'] } },
    { id: 'p2', name: 'P2', to: ['p2@example.com'], filters: { entities: ['globex'], riskSeverityMin: 'high' } },
  ],
  jobs: [
    {
      id: 'week',
      type: 'week_in_review',
      enabled: true,
      schedule: { cron: '0 9 * * MON', timezone: 'UTC' },
      notify: {
        enabled: true,
        mode: 'routes',
        routes: [{ profileId: 'p1' }, { profileId: 'p2' }],
        includeLinks: true,
      },
    },
  ],
} as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SubscriptionsPageClient', () => {
  it('renders profiles list from mocked GET', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ config: baseConfig }) }));

    render(<SubscriptionsPageClient />);

    expect(await screen.findByRole('heading', { name: 'p1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'p2' })).toBeInTheDocument();
  });

  it('add profile and save triggers PUT with correct shape', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ config: baseConfig }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ config: { ...baseConfig, recipientProfiles: [...baseConfig.recipientProfiles, { id: 'p3', to: ['p3@example.com'], filters: {} }] } }) });

    vi.stubGlobal('fetch', fetchMock);

    render(<SubscriptionsPageClient />);
    await screen.findByRole('heading', { name: 'p1' });

    fireEvent.change(screen.getByLabelText('Id'), { target: { value: 'p3' } });
    const toInputs = screen.getAllByLabelText('To emails (comma separated)');
    fireEvent.change(toInputs[toInputs.length - 1], { target: { value: 'p3@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add profile' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/admin/schedules',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    const putBody = JSON.parse((fetchMock.mock.calls[1]?.[1] as { body: string }).body);
    expect(putBody.recipientProfiles.some((profile: { id: string }) => profile.id === 'p3')).toBe(true);
  });

  it('delete profile removes routes referencing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ config: baseConfig }) }));
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));

    render(<SubscriptionsPageClient />);
    await screen.findByRole('heading', { name: 'p1' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete profile' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Job Routing & Notify Settings' }));

    expect(screen.queryByRole('option', { name: 'p2' })).not.toBeInTheDocument();
  });

  it('routing editor prevents duplicate route entries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ config: baseConfig }) }));

    render(<SubscriptionsPageClient />);
    await screen.findByRole('heading', { name: 'p1' });

    fireEvent.click(screen.getByRole('button', { name: 'Job Routing & Notify Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add route' }));

    expect(screen.getAllByDisplayValue(/p[12]/i)).toHaveLength(2);
  });

  it('toggling mode switches inputs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ config: baseConfig }) }));

    render(<SubscriptionsPageClient />);
    await screen.findByRole('heading', { name: 'p1' });
    fireEvent.click(screen.getByRole('button', { name: 'Job Routing & Notify Settings' }));

    expect(screen.queryByLabelText('To emails')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('notify mode week'), { target: { value: 'broadcast' } });
    expect(screen.getByLabelText('To emails')).toBeInTheDocument();
  });
});
