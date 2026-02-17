import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const refreshMock = vi.hoisted(() => vi.fn());
const rebuildIndexMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('../lib/rebuildIndexClient', () => ({
  rebuildIndex: rebuildIndexMock,
}));

import RebuildIndexButton from './RebuildIndexButton';

describe('RebuildIndexButton', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('disables button while loading', async () => {
    let resolveResult: ((value: { ok: true }) => void) | null = null;
    rebuildIndexMock.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        resolveResult = resolve;
      }),
    );

    render(<RebuildIndexButton />);

    const button = screen.getByRole('button', { name: /rebuild index/i });
    fireEvent.click(button);

    expect(screen.getByRole('button', { name: /rebuilding/i })).toBeDisabled();

    resolveResult?.({ ok: true });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /rebuild index/i })).not.toBeDisabled();
    });
  });

  it('refreshes router after successful rebuild', async () => {
    rebuildIndexMock.mockResolvedValue({ ok: true });

    render(<RebuildIndexButton />);

    fireEvent.click(screen.getByRole('button', { name: /rebuild index/i }));

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it('shows error message when rebuild fails', async () => {
    rebuildIndexMock.mockResolvedValue({ ok: false, message: 'No access', code: 'forbidden' });

    render(<RebuildIndexButton />);

    fireEvent.click(screen.getByRole('button', { name: /rebuild index/i }));

    expect(await screen.findByText('No access')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
