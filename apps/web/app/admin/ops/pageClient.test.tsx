import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import OpsPageClient from './pageClient';

const statusPayload = {
  ok: true,
  generatedAtISO: '2026-01-01T00:00:00Z',
  scheduler: { lock: { held: false }, lastCronRunISO: '2026-01-01T00:00:00Z' },
  jobs: [{ jobId: 'week', type: 'week_in_review', enabled: true, schedule: { cron: '* * * * *', timezone: 'UTC' }, lastRun: { tsISO: '2026', ok: true } }],
  issues: {
    missingEnvTargets: { slack: ['MISSING'], webhook: [] },
    auth: { missingRefreshToken: true, insufficientScope: false, notes: [] },
    recentFailures: [],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpsPageClient', () => {
  it('renders status payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => statusPayload }));
    render(<OpsPageClient />);
    await waitFor(() => expect(screen.getByText('Ops Dashboard')).toBeInTheDocument());
    expect(screen.getByText(/Missing Slack keys/)).toHaveTextContent('MISSING');
  });

  it('run now calls API and refreshes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => statusPayload })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => statusPayload });
    vi.stubGlobal('fetch', fetchMock);
    render(<OpsPageClient />);
    await waitFor(() => screen.getAllByText('Run now').length > 0);
    fireEvent.click(screen.getAllByText('Run now')[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/ops/run-now', { method: 'POST' }));
  });
});
